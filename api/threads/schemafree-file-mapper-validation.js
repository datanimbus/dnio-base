const { parentPort, workerData } = require('worker_threads');
const _ = require('lodash');
const mongoose = require('mongoose');
const log4js = require('log4js');

const config = require('../../config');

// mongoose.set('useFindAndModify', false);

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

	const req = workerData.req;
	const data = workerData.data;
	const fileId = data.fileId;
	const fileName = data.fileName;
	const isHeaderProvided = Boolean.valueOf(data.headers);
	let txnId = req.headers[global.txnIdHeader];
	logger.debug(`[${txnId}] Schema Free File Mapper Validation process started :: ${fileId}`);

	const fileMapperUtils = require('../utils/fileMapper.utils');
	const commonUtils = require('../utils/common.utils');
	const workflowUtils = require('../utils/workflow.utils');

	logger.level = LOG_LEVEL;

	const model = mongoose.model('fileMapper');
	const fileTransfersModel = mongoose.model('fileTransfers');
	// Reading File data from GRIDFS
	let bufferData = await fileMapperUtils.readDataFromGridFS(fileId);
	logger.debug(`[${txnId}] Buffer data read from file :: ${fileId}`);
	logger.trace(`[${txnId}] Buffer data read from file :: ${bufferData}`);

	// Deleting any previous records for this same file id
	await model.deleteMany({ fileId });

	let serializedData;
	if (fileName.split('.').pop() === 'json') {

		bufferData = JSON.parse(bufferData);
		if (!Array.isArray(bufferData)) {
			logger.debug(`[${txnId}] Buffer data is not array`);
			bufferData = [bufferData];
		}

		logger.trace(`[${txnId}] Parsed buffer data :: ${JSON.stringify(bufferData)}`);
	} else {
		bufferData = await fileMapperUtils.getSheetData(bufferData, false);
	}

	logger.trace(`[${txnId}] Parsed buffer data :: ${JSON.stringify(bufferData)}`);

	// Updating transfer model to reflect validating status
	let fileTransferDocumentId = await fileTransfersModel.collection.findOne({ fileId: fileId });
	fileTransferDocumentId = fileTransferDocumentId._id;

	await fileTransfersModel.findOneAndUpdate({ _id: fileTransferDocumentId }, { $set: { isHeaderProvided: false, headerMapping: null, status: 'Validating' } });

	// creating serialized data for storing to bulkCreate collection
	serializedData = bufferData.map((e, i) => {
		const temp = {};
		temp.fileId = fileId;
		temp.fileName = fileName;
		temp.sNo = isHeaderProvided ? (i + 1) : i;
		temp.data = JSON.parse(JSON.stringify(e));
		return temp;
	});

	logger.trace(`[${txnId}] Serialized Data :: ${JSON.stringify(serializedData)}`);

	// Creating batches of 5000 records each
	let batch = [serializedData];
	if (serializedData.length > 5000) {
		batch = _.chunk(serializedData, 5000);
	}

	// Inserting data to bulkCreate model
	await Promise.all(batch.map((e) => model.insertMany(e)));

	batch = null;
	serializedData = null;

	// Checking for duplicate records in the file data
	let duplicateDocs = await model.aggregate([
		{ $match: { fileId, 'data._id': { $exists: true } } },
		{ $group: { _id: '$data._id', count: { $sum: 1 } } },
		{ $match: { _id: { $ne: null }, count: { $gt: 1 } } },
		{ $project: { 'duplicateId': '$_id', _id: 0 } },
	]);
	logger.trace(`[${txnId}] Duplicate Records in the file :: ${JSON.stringify(duplicateDocs)}`);

	let duplicateIds = _.map(duplicateDocs, 'duplicateId');
	let arr = [];
	arr.push(model.updateMany({ fileId, 'data._id': { $in: duplicateIds } }, { $set: { status: 'Duplicate', conflict: false } }));
	arr.push(model.updateMany({ fileId, 'data._id': { $nin: duplicateIds }, status: { $ne: 'Error' } }, { $set: { status: 'Validated' } }));
	await Promise.all(arr);

	duplicateDocs = null;
	duplicateIds = null;
	arr = null;

	// Checking for conflicts with already existing data
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

	logger.trace(`[${txnId}] Conflict records in data service :: ${JSON.stringify(conflictDocs)}`);

	let conflictIds = _.map(conflictDocs, '_id');
	await model.updateMany({ fileId, 'data._id': { $in: conflictIds } }, { $set: { status: 'Duplicate', conflict: true } });

	conflictDocs = null;
	conflictIds = null;

	let pendingDocs = (await model.find({ fileId }));
	batch = [pendingDocs];
	if (pendingDocs.length > 2500) {
		batch = _.chunk(pendingDocs, 2500);
	}

	await batch.reduce((prev, items) => {
		return prev.then(() => {
			const tempPromises = items.map(async (doc) => {
				try {
					const data = await workflowUtils.simulateJSON(req, doc.toObject().data, {
						operation: doc.data._id ? 'PUT' : 'POST',
						source: 'fileMapper Validation',
						schemaFree: true
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
			return Promise.all(tempPromises);
		});
	}, Promise.resolve());

	let duplicateRecords = await model.count({fileId, status: 'Duplicate', conflict: false});
	let conflictRecords = await model.count({fileId, status: 'Duplicate', conflict: true});
	let validRecords = await model.count({fileId, status: 'Validated'});
	let errorRecords = await model.count({fileId, status: 'Error'});
	let finalData = { 
		duplicateCount: duplicateRecords,
		conflictCount: conflictRecords,
		validCount: validRecords,
		errorCount: errorRecords
	};

	// let finalData = await model.aggregate([
	// 	{
	// 		$facet: {
	// 			duplicateCount: [
	// 				{ $match: { fileId, status: 'Duplicate', conflict: false } },
	// 				{ $count: 'count' }
	// 			],
	// 			conflictCount: [
	// 				{ $match: { fileId, status: 'Duplicate', conflict: true } },
	// 				{ $count: 'count' }
	// 			],
	// 			validCount: [
	// 				{ $match: { fileId, status: 'Validated' } },
	// 				{ $count: 'count' }
	// 			],
	// 			errorCount: [
	// 				{ $match: { fileId, status: 'Error' } },
	// 				{ $count: 'count' }
	// 			]
	// 		}
	// 	}
	// ]);
	logger.trace(`[${txnId}] Final Data :: ${JSON.stringify(finalData)}`);

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
	await fileTransfersModel.findOneAndUpdate({ _id: fileTransferDocumentId }, { $set: result });
	return result;
}

setTimeout(() => {
	execute().then(result => {
		parentPort.postMessage(result);
	}).catch(err => {
		throw err;
	});
}, 1000);
