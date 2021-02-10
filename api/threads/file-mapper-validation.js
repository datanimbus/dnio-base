const { parentPort, workerData } = require('worker_threads');
const _ = require('lodash');
const mongoose = require('mongoose');
mongoose.set('useFindAndModify', false);

const config = require('../../config');

const log4js = require('log4js');
const LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceName} v.${config.serviceVersion}] [Worker]` : `[${config.serviceName} v.${config.serviceVersion}] [Worker]`;
const LOG_LEVEL = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info';
log4js.configure({
	appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
	categories: { default: { appenders: ['out'], level: LOG_LEVEL } }
});
const logger = log4js.getLogger(LOGGER_NAME);

global.logger = logger;
global.userHeader = 'user';
global.txnIdHeader = 'txnId';

require('../../db-factory');
global.doNotSubscribe = true;

async function execute() {
	const fileMapperUtils = require('../utils/fileMapper.utils');
	const commonUtils = require('../utils/common.utils');
	const workflowUtils = require('../utils/workflow.utils');

	logger.level = LOG_LEVEL;
	const model = mongoose.model('fileMapper');
	const fileTransfersModel = mongoose.model('fileTransfers');

	const data = workerData.data;
	const req = workerData.req;
	const fileId = data.fileId;
	let txnId = workerData.req.headers[global.txnIdHeader];
	logger.debug(`[${txnId}] Worker :: ${fileId}`);
	const isHeaderProvided = Boolean.valueOf(data.headers);
	const headerMapping = data.headerMapping;
	const fileName = data.fileName;
	const bufferData = await fileMapperUtils.readDataFromGridFS(fileId);
	let startTime = Date.now();
	const sheetData = await fileMapperUtils.getSheetData(bufferData, isHeaderProvided);
	let endTime = Date.now();
	logger.debug('=======================================');
	logger.debug('SHEET READ :: ', endTime - startTime);
	logger.debug('=======================================');
	let mappedSchemaData;
	startTime = Date.now();
	if (Array.isArray(sheetData)) {
		mappedSchemaData = sheetData.map(e => fileMapperUtils.objectMapping(e, headerMapping));
	} else {
		mappedSchemaData = [fileMapperUtils.objectMapping(sheetData, headerMapping)];
	}
	endTime = Date.now();
	logger.debug('=======================================');
	logger.debug('OBJECT MAPPING :: ', endTime - startTime);
	logger.debug('=======================================');
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
		return temp;
	});
	mappedSchemaData = null;
	endTime = Date.now();
	logger.debug('=======================================');
	logger.debug('SERIALIZED DATA :: ', endTime - startTime);
	logger.debug('=======================================');
	startTime = Date.now();
	let batch = [serializedData];
	if (serializedData.length > 5000) {
		batch = _.chunk(serializedData, 5000);
	}
	await Promise.all(batch.map((e) => model.insertMany(e)));
	batch = null;
	serializedData = null;
	endTime = Date.now();
	logger.debug('=======================================');
	logger.debug('INSERT MANY :: ', endTime - startTime);
	logger.debug('=======================================');
	startTime = Date.now();
	let duplicateDocs = await model.aggregate([
		{ $match: { fileId, 'data._id': { $exists: true } } },
		{ $group: { _id: '$data._id', count: { $sum: 1 } } },
		{ $match: { _id: { $ne: null }, count: { $gt: 1 } } },
		{ $project: { 'duplicateId': '$_id', _id: 0 } },
	]);
	let duplicateIds = _.map(duplicateDocs, 'duplicateId');
	let arr = [];
	arr.push(model.updateMany({ fileId, 'data._id': { $in: duplicateIds } }, { $set: { status: 'Duplicate' } }));
	arr.push(model.updateMany({ fileId, 'data._id': { $exists: false } }, { $set: { status: 'Validated' } }));
	await Promise.all(arr);
	duplicateDocs = null;
	duplicateIds = null;
	arr = null;
	endTime = Date.now();
	logger.debug('=======================================');
	logger.debug('STATUS UPDATE :: ', endTime - startTime);
	logger.debug('=======================================');
	startTime = Date.now();
	let conflictDocs = await model.aggregate([
		{ $match: { fileId, 'data._id': { $exists: true } } },
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
	let conflictIds = _.map(conflictDocs, '_id');
	await model.updateMany({ fileId, 'data._id': { $in: conflictIds } }, { $set: { conflict: true } });
	conflictDocs = null;
	conflictIds = null;
	endTime = Date.now();
	logger.debug('=======================================');
	logger.debug('CONFLICT UPDATE :: ', endTime - startTime);
	logger.debug('=======================================');
	startTime = Date.now();
	let pendingDocs = (await model.find({ fileId }));
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
						doc.message = err.error.message;
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
	logger.debug('=======================================');
	logger.debug('SIMULATION :: ', endTime - startTime);
	logger.debug('=======================================');
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
	logger.debug('=======================================');
	logger.debug('$FACET :: ', endTime - startTime);
	logger.debug('=======================================');
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
	logger.debug('=======================================');
	logger.debug('MEMORY USAGE :: ', process.memoryUsage());
	logger.debug('=======================================');
	if (errorCount > 100 || conflictCount > 100) {
		result.status = 'Error';
	}
	// mongoose.disconnect();
	return result;
}

setTimeout(() => {
	execute().then(result => {
		parentPort.postMessage(result);
	}).catch(err => {
		throw err;
	});
}, 1000);