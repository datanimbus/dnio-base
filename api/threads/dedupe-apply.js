const { parentPort, workerData } = require('worker_threads');
const log4js = require('log4js');
const mongoose = require('mongoose');
const _ = require('lodash');

// mongoose.set('useFindAndModify', false);

const config = require('../../config');
require('../../queue');

const LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceName} v.${config.serviceVersion}] [Worker]` : `[${config.serviceName} v.${config.serviceVersion}] [Worker]`;
const LOG_LEVEL = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info';
log4js.configure({
	appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
	categories: { default: { appenders: ['out'], level: LOG_LEVEL } }
});
const logger = log4js.getLogger(LOGGER_NAME);

global.userHeader = 'user';
global.txnIdHeader = 'txnId';

require('../../db-factory');

async function execute() {
	const { mergeCustomizer } = require('../utils/common.utils');

	const model = mongoose.model('dedupe');
	const serviceModel = mongoose.model(config.serviceId);

	logger.level = LOG_LEVEL;
	const dedupeId = workerData.dedupeId;
	const dedupeFields = workerData.dedupeFields;
	const req = workerData.reqData;
	const user = req.headers[global.userHeader];
	const txnId = req.headers[global.txnIdHeader];
	logger.debug(`[${txnId}] :: Applying Dedupe of ${user} on fields ${dedupeFields} with dedupeId ${dedupeId}`);
	try {
		let cursor = await model.find({ dedupeId, user }).cursor();
		await applyDedupeAction(cursor);
		logger.debug(`Applied dedupe action on items with Dedupe ID ${dedupeId} for user ${user}`);
		return {
			message: 'Dedupe record actions are applied.',
			user: user
		};
	} catch (e) {
		logger.error('Error in executiing dedupe-apply thread :: ', e);
		throw e;
	}

	async function applyDedupeAction(cursor, dedupeId, user) {
		try {
			let doc = await cursor.next();
			if (!doc) {
				return;
			}
			let newDoc = doc.newDoc;
			try {
				if (doc.action == 'MARK_ONE') {
					// Remove other records in DS collection
					let documetsToRemove = doc.docs.filter(d => d._id != newDoc._id)
						.map(doc => doc._id);
					await removeServiceDocuments(documetsToRemove);
					doc.result = 'SUCCESS';
					doc.newDoc = doc.docs.find(d => d._id != newDoc._id);
				} else if (doc.action == 'CREATE_NEW') {
					// Remove all records in DS collection and create new
					let documetsToRemove = doc.docs.map(d => d._id);
					await removeServiceDocuments(documetsToRemove);
					let newServiceDoc = new serviceModel(newDoc);
					newServiceDoc._req = req;
					await newServiceDoc.save();
					doc.result = 'SUCCESS';
					if (!doc.newDoc._id) {
						doc.newDoc._id = newServiceDoc._id;
					}
				} else if (doc.action == 'UPDATE_ONE') {
					// Remove all other records in DS collection and update with newDoc
					let documetsToRemove = doc.docs.filter(d => d._id != newDoc._id)
						.map(doc => doc._id);
					await removeServiceDocuments(documetsToRemove);
					let serviceDoc = await serviceModel.findById(newDoc._id);
					_.mergeWith(serviceDoc, newDoc, mergeCustomizer);
					serviceDoc._req = req;
					await serviceDoc.save();
					doc.result = 'SUCCESS';
				} else if (doc.action == 'DISCARD') {
					doc.result = 'SUCCESS';
				} else {
					logger.error(`Unknow action ${doc.action} for dedupe Item ${doc._id}`);
					throw new Error(`Unknow action ${doc.action} for dedupe Item`);
				}
			} catch (err) {
				logger.error(`Error in ${doc.action} for dedupe Item ${doc._id}`, err);
				doc.result = 'FAILED';
				doc.errMessage = err.message;
			}
			await doc.save();
			return applyDedupeAction(cursor, dedupeId, user);
		} catch (e) {
			logger.error('Error in applyDedupeAction :: ', e);
			throw e;
		}
	}

	async function removeServiceDocuments(documentIds) {
		let promises = documentIds.map(async (docId) => {
			try {
				let document = await serviceModel.findById(docId);
				return await document.remove();
			} catch (err) {
				logger.error('Error in removing document ' + docId, err);
				return Promise.reject(err);
			}
		});
		return Promise.all(promises).then(removedDocs => {
			logger.debug('Removed serivce document with Ids ', removedDocs.map(doc => doc._id));
		}).catch(err => {
			logger.error('Error in removing documents ', err);
			return Promise.reject(err);
		});
	}
}

setTimeout(() => {
	execute().then(result => {
		parentPort.postMessage(result);
	}).catch(err => {
		throw err;
	});
}, 1000);