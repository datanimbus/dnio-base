const { parentPort, workerData } = require('worker_threads');
const _ = require('lodash');
const log4js = require('log4js');
const mongoose = require('mongoose');

// mongoose.set('useFindAndModify', false);

const config = require('../../config');

let additionalLoggerIdentifier = 'Worker/MapperCreate';

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
// global.baseKey = workerData.baseKey;
// global.baseCert = workerData.baseCert;
global.encryptionKey = workerData.encryptionKey;

async function execute() {
	await require('../../db-factory').initForWorker(additionalLoggerIdentifier);

	logger = global.logger;

	require('../../queue');

	const workflowUtils = require('../utils/workflow.utils');
	const { mergeCustomizer } = require('./../utils/common.utils');
	// const authorDB = global.authorDB;
	// const workflowModel = authorDB.model('workflow');
	const workflowModel = mongoose.model('workflow');
	const model = mongoose.model('fileMapper');
	const serviceModel = mongoose.model(config.serviceId);

	logger.level = LOG_LEVEL;
	const data = workerData.data;
	const fileId = data.fileId;
	const create = data.create ? data.create : [];
	const update = data.update ? data.update : [];
	const req = workerData.req;
	const schemaFree = workerData.schemaFree;

	/**---------- After Response Process ------------*/
	let docsToCreate = await model.find({ fileId, $or: [{ status: 'Validated' }, { sNo: { $in: create } }] });
	let createBatch = [docsToCreate];
	if (docsToCreate.length > 2500) {
		createBatch = _.chunk(docsToCreate, 2500);
	}
	await createBatch.reduce((prev, docs) => {
		return prev.then(() => {
			let temp = docs.map(async (doc) => {
				try {
					const hasSkipReview = await workflowUtils.hasAdminAccess(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []));
					if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
						const wfItem = workflowUtils.getWorkflowItem(req, 'POST', doc.data._id, 'Pending', doc.data, null);
						const wfDoc = new workflowModel(wfItem);
						wfDoc._req = req;
						const status = await wfDoc.save();
						if (!doc._metadata) {
							doc._metadata = {};
						}
						doc._metadata.workflow = status._id;
					} else {
						const temp = new serviceModel(doc.data);
						temp._req = req;
						await temp.save();
					}
					doc.status = 'Created';
				} catch (e) {
					doc.status = 'Error';
					if (e.message) {
						doc.message = e.message;
					} else {
						doc.message = Object.values(e).join();
					}
				} finally {
					await doc.save();
				}
			});
			return Promise.all(temp);
		});
	}, Promise.resolve());

	let docsToUpdate = await model.find({ fileId, sNo: { $in: update } });
	let updateBatch = [docsToUpdate];
	if (docsToUpdate.length > 2500) {
		updateBatch = _.chunk(docsToUpdate, 2500);
	}
	await updateBatch.reduce((prev, docs) => {
		return prev.then(() => {
			let temp = docs.map(async (doc) => {
				try {
					let temp = await serviceModel.findById(doc.data._id);
					const hasSkipReview = await workflowUtils.hasAdminAccess(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []));
					if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
						const wfItem = workflowUtils.getWorkflowItem(req, 'PUT', doc.data._id, 'Pending', doc.data, temp.toObject());
						const wfDoc = new workflowModel(wfItem);
						wfDoc._req = req;
						const status = await wfDoc.save();
						await serviceModel.findByIdAndUpdate(temp._id, { '_metadata.workflow': status._id });
						if (!doc._metadata) {
							doc._metadata = {};
						}
						doc._metadata.workflow = status._id;
					} else {
						temp._oldDoc = temp.toObject();
						temp._req = req;

						if (!schemaFree) {
							_.mergeWith(temp, doc.data, mergeCustomizer);
						} else {
							let tempDoc = doc.toObject();
							let tDoc = temp.toObject();
							Object.keys(tDoc).forEach(key => {
								if (key !== '__v' && key !== '_id' && key !== '_metadata' && key !== '_workflow') {
									if (tempDoc.data[key] == undefined) {
										// temp.unset(key);
										delete tDoc[key];
									}
								}
							});
							Object.keys(tempDoc.data).forEach(key => {
								if (key !== '__v' && key !== '_id' && key !== '_metadata' && key !== '_workflow') {
									if (tDoc[key] !== tempDoc.data[key])
										tDoc[key] = tempDoc.data[key];
								}
							});
							temp.overwrite(tDoc);
						}

						temp = await temp.save();
					}
					doc.status = 'Updated';
				} catch (e) {
					doc.status = 'Error';
					if (e.message) {
						doc.message = e.message;
					} else {
						doc.message = Object.values(e).join();
					}
				} finally {
					await doc.save();
				}
			});
			return Promise.all(temp);
		});
	}, Promise.resolve());
	let createdRecords = await model.count({ fileId, status: 'Created' });
	let updatedRecords = await model.count({ fileId, status: 'Updated' });
	let errorRecords = await model.count({ fileId, status: 'Error' });
	const finalData =  {
		createdCount: createdRecords,
		updatedCount: updatedRecords,
		errorCount: errorRecords
	};
	const result = {
		createdCount: (finalData[0].createdCount).length > 0 ? finalData[0].createdCount[0].count : 0,
		updatedCount: (finalData[0].updatedCount).length > 0 ? finalData[0].updatedCount[0].count : 0,
		errorCount: (finalData[0].errorCount).length > 0 ? finalData[0].errorCount[0].count : 0,
		status: 'Created',
		'_metadata.lastUpdated': new Date()
	};
	if (!(result.createdCount || result.updatedCount)) {
		result.status = 'Error';
	}
	mongoose.disconnect();
	return result;
}

setTimeout(() => {
	execute().then(result => {
		parentPort.postMessage(result);
	}).catch(err => {
		throw err;
	});
}, 1000);