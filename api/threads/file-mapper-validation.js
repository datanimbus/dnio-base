const { parentPort, workerData } = require('worker_threads');
const mongoose = require('mongoose');
const log4js = require('log4js');
const sift = require('sift');
const _ = require('lodash');

// mongoose.set('useFindAndModify', false);

const config = require('../../config');

let additionalLoggerIdentifier = 'Worker/MapperValidation';

let LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceId}] [${additionalLoggerIdentifier}]` : `[${config.serviceId}][${additionalLoggerIdentifier}]`;
global.loggerName = LOGGER_NAME;

const LOG_LEVEL = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info';
global.LOG_LEVEL = LOG_LEVEL;

log4js.configure({
	appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
	categories: { default: { appenders: ['out'], level: LOG_LEVEL } }
});
let logger = log4js.getLogger(LOGGER_NAME);

global.userHeader = 'user';
global.txnIdHeader = 'txnId';
global.doNotSubscribe = true;

async function execute() {
	await require('../../db-factory').initForWorker(additionalLoggerIdentifier);

	logger = global.logger;

	const fileMapperUtils = require('../utils/fileMapper.utils');
	const commonUtils = require('../utils/common.utils');
	const workflowUtils = require('../utils/workflow.utils');
	const specialUtils = require('../utils/special-fields.utils');

	const model = mongoose.model('fileMapper');
	const fileTransfersModel = mongoose.model('fileTransfers');

	const data = workerData.data;
	const req = workerData.req;
	const fileId = data.fileId;

	const dynamicFilter = await specialUtils.getDynamicFilter(req);
	logger.debug('Dynamic Filter in File Mapper:', dynamicFilter);
	let tester;
	if (dynamicFilter && !_.isEmpty(dynamicFilter)) {
		tester = sift(dynamicFilter);
	}

	let txnId = workerData.req.headers[global.txnIdHeader];
	logger.debug(`[${txnId}] Worker :: ${fileId}`);
	const isHeaderProvided = Boolean.valueOf(data.headers);
	const headerMapping = data.headerMapping;
	const fileName = data.fileName;
	const bufferData = await fileMapperUtils.readDataFromGridFS(fileId);
	let startTime = Date.now();
	const sheetData = await fileMapperUtils.getSheetData(bufferData, isHeaderProvided);
	let endTime = Date.now();
	logger.debug(`[${fileId}] File mapper validation :: SHEET READ :: ${endTime - startTime} ms`);


	let mappedSchemaData;
	startTime = Date.now();
	if (Array.isArray(sheetData)) {
		mappedSchemaData = sheetData.map(e => fileMapperUtils.objectMapping(e, headerMapping));
	} else {
		mappedSchemaData = [fileMapperUtils.objectMapping(sheetData, headerMapping)];
	}
	endTime = Date.now();
	logger.debug(`[${fileId}] File mapper validation :: OBJECT MAPPING :: ${endTime - startTime} ms`);
	await fileTransfersModel.findOneAndUpdate({ fileId: fileId }, { $set: { isHeaderProvided, headerMapping, status: 'Validating' } });

	/**---------- After Response Process ------------*/
	startTime = Date.now();
	await model.deleteMany({ fileId });
	let serializedData = mappedSchemaData.map((e, i) => {
		const temp = {};
		temp.fileId = fileId;
		temp.fileName = fileName;
		temp.data = JSON.parse(JSON.stringify(e));
		temp.sNo = isHeaderProvided ? (i + 1) : i;
		if (tester && !tester(e)) {
			logger.debug('Record was rejected because of dynamic filter:', temp.sNo);
			temp.status = 'Error';
			temp.message = 'You don\'t have access for this operation.';
		}
		return temp;
	});
	mappedSchemaData = null;
	endTime = Date.now();
	logger.debug(`[${fileId}] File mapper validation :: SERIALIZED DATA :: ${endTime - startTime}ms`);
	startTime = Date.now();
	let batch = [serializedData];
	if (serializedData.length > 5000) {
		batch = _.chunk(serializedData, 5000);
	}
	await Promise.all(batch.map((e) => model.insertMany(e)));
	batch = null;
	serializedData = null;
	endTime = Date.now();
	logger.debug(`[${fileId}] File mapper validation :: INSERT MANY :: ${endTime - startTime}ms`);


	startTime = Date.now();
	let duplicateDocs = await model.aggregate([
		{ $match: { fileId, status: { $ne: 'Error' }, 'data._id': { $exists: true } } },
		{ $group: { _id: '$data._id', count: { $sum: 1 } } },
		{ $match: { _id: { $ne: null }, count: { $gt: 1 } } },
		{ $project: { 'duplicateId': '$_id', _id: 0 } },
	]);
	logger.trace('=======================================');
	logger.trace(`[${fileId}] DUPLICATE DOCS :: `, duplicateDocs);
	logger.trace('=======================================');
	let duplicateIds = _.map(duplicateDocs, 'duplicateId');
	let arr = [];
	arr.push(model.updateMany({ fileId, 'data._id': { $in: duplicateIds }, status: { $ne: 'Error' } }, { $set: { status: 'Duplicate', conflict: false } }));
	arr.push(model.updateMany({ fileId, 'data._id': { $nin: duplicateIds }, status: { $ne: 'Error' } }, { $set: { status: 'Validated' } }));
	await Promise.all(arr);
	duplicateDocs = null;
	duplicateIds = null;
	arr = null;
	endTime = Date.now();
	logger.debug(`[${fileId}] File mapper validation :: STATUS UPDATE :: ${endTime - startTime}ms`);



	startTime = Date.now();
	let conflictDocs = await model.aggregate([
		{ $match: { fileId, status: { $ne: 'Error' }, 'data._id': { $exists: true } } },
		{
			$lookup:
			{
				from: config.serviceCollection,
				localField: 'data._id',
				foreignField: '_id',
				as: '_foreign'
			}
		},
		{
			$unwind: '$_foreign'
		},
		{ $project: { duplicateId: '$_foreign._id', _id: 1 } },
		{ $group: { _id: '$duplicateId', count: { $sum: 1 } } }
	]);
	logger.trace('=======================================');
	logger.trace(`[${fileId}] CONFLICT DOCS :: `, conflictDocs);
	logger.trace('=======================================');
	let conflictIds = _.map(conflictDocs, '_id');
	await model.updateMany({ fileId, 'data._id': { $in: conflictIds }, status: { $ne: 'Error' } }, { $set: { status: 'Duplicate', conflict: true } });
	conflictDocs = null;
	conflictIds = null;
	endTime = Date.now();
	logger.debug(`[${fileId}] File mapper validation :: CONFLICT UPDATE :: ${endTime - startTime}ms`);

	startTime = Date.now();
	let pendingDocs = (await model.find({ fileId, status: { $ne: 'Error' } }));
	batch = [pendingDocs];
	if (pendingDocs.length > 2500) {
		batch = _.chunk(pendingDocs, 2500);
	}
	await batch.reduce((prev, items) => {
		return prev.then(() => {
			const tempPromises = items.map(async (doc) => {
				try {
					const data = await workflowUtils.simulate(req, doc.toObject().data, {
						operation: doc.data._id ? 'PUT' : 'POST',
						source: 'fileMapper Validation'
					});
					_.mergeWith(doc.data, data, commonUtils.mergeCustomizer);
					if (doc.status == 'Pending') {
						doc.status = 'Validated';
					}
					doc.markModified('data');
				} catch (err) {
					doc.status = 'Error';
					if (err.source) {
						doc.errorSource = err.source;
						if (err.error.message) {
							doc.message = err.error.message;
						} else {
							let message = '';
							if (typeof err.error === 'object') {
								Object.keys(err.error).forEach(key => {
									message += key + ' : ' + err.error[key] + '\n';
								});
							}
							doc.message = message ? message : JSON.stringify(err.error);
						}
					} else {
						doc.errorSource = 'Logic';
						doc.message = err.message;
					}
				} finally {
					await doc.save();
				}
			});
			// logger.debug('=======================================');
			// logger.debug('MEMORY USAGE :: ', process.memoryUsage());
			// logger.debug('=======================================');
			return Promise.all(tempPromises);
		});
	}, Promise.resolve());

	endTime = Date.now();
	logger.debug(`[${fileId}] File mapper validation :: SIMULATION :: ${endTime - startTime}ms`);
	startTime = Date.now();
	let finalData = await model.aggregate([
		{
			$facet: {
				duplicateCount: [
					{ $match: { fileId, status: 'Duplicate', conflict: false } },
					{ $count: 'count' }
				],
				conflictCount: [
					{ $match: { fileId, status: 'Duplicate', conflict: true } },
					{ $count: 'count' }
				],
				validCount: [
					{ $match: { fileId, status: 'Validated' } },
					{ $count: 'count' }
				],
				errorCount: [
					{ $match: { fileId, status: 'Error' } },
					{ $count: 'count' }
				]
			}
		}
	]);
	endTime = Date.now();
	logger.debug(`[${fileId}] File mapper validation :: $FACET :: ${endTime - startTime}ms`);
	const validCount = (finalData[0].validCount).length > 0 ? finalData[0].validCount[0].count : 0;
	const errorCount = (finalData[0].errorCount).length > 0 ? finalData[0].errorCount[0].count : 0;
	const duplicateCount = (finalData[0].duplicateCount).length > 0 ? finalData[0].duplicateCount[0].count : 0;
	const conflictCount = (finalData[0].conflictCount).length > 0 ? finalData[0].conflictCount[0].count : 0;
	const result = {
		duplicateCount,
		conflictCount,
		validCount,
		errorCount,
		status: 'Validated',
		'_metadata.lastUpdated': new Date()
	};
	finalData = null;
	logger.debug(`[${fileId}] File mapper validation :: MEMORY USAGE :: ${JSON.stringify(process.memoryUsage())}`);

	if (errorCount > 100 || conflictCount > 100) {
		result.status = 'Error';
	}
	// mongoose.disconnect();
	await fileTransfersModel.findOneAndUpdate({ fileId: fileId }, { $set: result });
	return result;
}

setTimeout(() => {
	execute().then(result => {
		parentPort.postMessage(result);
	}).catch(err => {
		throw err;
	});
}, 1000);