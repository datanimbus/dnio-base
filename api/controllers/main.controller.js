const router = require('express').Router();
const mongoose = require('mongoose');
const swaggerParser = require('swagger-parser');
const async = require('async');
const _ = require('lodash');

const config = require('../../config');
const queue = require('../../queue');
const specialFields = require('../utils/special-fields.utils');
const hooksUtils = require('../utils/hooks.utils');
const crudderUtils = require('../utils/crudder.utils');
const workflowUtils = require('../utils/workflow.utils');
const { mergeCustomizer, getDiff, modifySecureFieldsFilter } = require('./../utils/common.utils');

const logger = global.logger;
const model = mongoose.model(config.serviceId);
let softDeletedModel;
if (!config.permanentDelete) softDeletedModel = mongoose.model(config.serviceId + '.deleted');
const mathQueue = async.priorityQueue(processMathQueue);
const client = queue.client;

router.get('/doc', (req, res) => {
	async function execute() {
		try {
			const obj = await swaggerParser.parse('../swagger/swagger.yaml');
			obj.host = req.query.host;
			obj.basePath = req.query.basePath ? req.query.basePath : obj.basePath;
			addAuthHeader(obj.paths, req.query.token);
			res.status(200).json(obj);
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

router.get('/utils/securedFields', (req, res) => {
	async function execute() {
		try {
			res.status(200).json(specialFields.secureFields);
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

router.get('/utils/bulkShow', (req, res) => {
	async function execute() {
		try {
			const ids = req.query.id ? req.query.id.split(',') : [];
			const filter = {
				'_id': {
					'$in': ids
				},
				'_metadata.deleted': false
			};
			let select = '';
			let sort = '';
			if (req.query.select && req.query.select.trim()) {
				select = req.query.select.split(',').join(' ');
			}
			if (req.query.sort && req.query.sort.trim()) {
				sort = req.query.sort.split(',').join(' ');
			}
			const docs = await model.find(filter).select(select).sort(sort).lean();
			res.status(200).json(docs);
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

router.put('/bulkUpdate', (req, res) => {
	async function execute() {
		// const workflowModel = global.authorDB.model('workflow');
		const workflowModel = mongoose.model('workflow');
		try {
			const id = req.query.id;
			if (!id) {
				return res.status(400).json({
					message: 'Invalid IDs'
				});
			}
			const ids = id.split(',');
			const filter = {
				'_id': {
					'$in': ids
				},
				'_metadata.deleted': false
			};
			const docs = await model.find(filter);
			const promises = docs.map(async (doc) => {
				doc._req = req;
				doc._oldDoc = doc.toObject();
				const payload = doc.toObject();
				_.mergeWith(payload, req.body, mergeCustomizer);
				const hasSkipReview = await workflowUtils.hasSkipReview(req);
				if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
					const wfItem = workflowUtils.getWorkflowItem(req, 'PUT', doc._id, 'Pending', payload, doc.toObject());
					const wfDoc = new workflowModel(wfItem);
					wfDoc._req = req;
					let status = await wfDoc.save();
					doc._metadata.workflow = status._id;
					await doc.save();
				} else {
					_.mergeWith(doc, req.body, mergeCustomizer);
					return new Promise((resolve) => { doc.save().then(resolve).catch(resolve); });
				}
			});
			const allResult = await Promise.all(promises);
			if (allResult.every(e => e._id)) {
				return res.status(200).json(allResult);
			} else if (allResult.every(e => !e._id)) {
				return res.status(400).json(allResult);
			} else {
				return res.status(207).json(allResult);
			}
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

router.delete('/utils/bulkDelete', (req, res) => {
	async function execute() {
		// const workflowModel = global.authorDB.model('workflow');
		const workflowModel = mongoose.model('workflow');
		try {
			const ids = req.body.ids;
			if (!ids || ids.length == 0) {
				return res.status(400).json({
					message: 'Invalid IDs'
				});
			}
			const filter = {
				'_id': {
					'$in': ids
				},
				'_metadata.deleted': false
			};
			const docs = await model.find(filter);
			const promises = docs.map(async (doc) => {
				doc._req = req;
				doc._oldDoc = doc.toObject();
				const hasSkipReview = await workflowUtils.hasSkipReview(req);
				if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
					const wfItem = workflowUtils.getWorkflowItem(req, 'DELETE', doc._id, 'Pending', null, doc.toObject());
					const wfDoc = new workflowModel(wfItem);
					wfDoc._req = req;
					let status = await wfDoc.save();
					doc._metadata.workflow = status._id;
					return await doc.save();
				} else {
					if (!config.permanentDelete) {
						let softDeletedDoc = softDeletedModel(doc);
						await softDeletedDoc.save();
					}
					return new Promise((resolve) => { doc.remove().then(resolve).catch(() => resolve(null)); });
				}
			});
			const allResult = await Promise.all(promises);
			const removedIds = allResult.filter(doc => doc != null).map(doc => doc._id);
			const docsNotRemoved = _.difference(_.uniq(ids), removedIds);
			if (_.isEmpty(docsNotRemoved)) {
				return res.status(200).json({});
			} else {
				return res.status(400).json({ message: 'Could not delete document with id ' + docsNotRemoved });
			}
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

/**
 * @deprecated
 */
router.get('/utils/count', (req, res) => {
	async function execute() {
		try {
			let filter = {};
			let errors = {};
			try {
				if (req.query.filter) {
					filter = JSON.parse(req.query.filter);
					const tempFilter = await specialFields.patchRelationInFilter(req, filter, errors);
					if (Array.isArray(tempFilter) && tempFilter.length > 0) {
						filter = tempFilter[0];
					} else if (tempFilter) {
						filter = tempFilter;
					}
					filter = modifySecureFieldsFilter(filter, specialFields.secureFields,false);
				}
			} catch (e) {
				logger.error(e);
				return res.status(400).json({
					message: e
				});
			}
			if (filter) {
				filter = crudderUtils.parseFilter(filter);
			}
			if (errors && Object.keys(errors).length > 0) {
				logger.warn('Error while fetching relation: ', JSON.stringify(errors));
			}
			const count = await model.countDocuments(filter);
			res.status(200).json(count);
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

router.get('/', (req, res) => {
	async function execute() {
		try {
			let filter = {};
			let errors = {};
			try {
				if (req.query.filter) {
					filter = JSON.parse(req.query.filter);
					const tempFilter = await specialFields.patchRelationInFilter(req, filter, errors);
					if (Array.isArray(tempFilter) && tempFilter.length > 0) {
						filter = tempFilter[0];
					} else if (tempFilter) {
						filter = tempFilter;
					}
					filter = modifySecureFieldsFilter(filter, specialFields.secureFields,false);
				}
			} catch (e) {
				logger.error(e);
				return res.status(400).json({
					message: e
				});
			}
			if (filter) {
				filter = crudderUtils.parseFilter(filter);
			}
			if (errors && Object.keys(errors).length > 0) {
				logger.warn('Error while fetching relation: ', JSON.stringify(errors));
			}
			if (req.query.countOnly) {
				const count = await model.countDocuments(filter);
				return res.status(200).json(count);
			}
			let skip = 0;
			let count = 30;
			let select = '';
			let sort = '';
			if (req.query.count && (+req.query.count) > 0) {
				count = +req.query.count;
			}
			if (req.query.page && (+req.query.page) > 0) {
				skip = count * ((+req.query.page) - 1);
			}
			if (req.query.select && req.query.select.trim()) {
				select = req.query.select.split(',').join(' ');
			}
			if (req.query.sort && req.query.sort.trim()) {
				sort = req.query.sort.split(',').join(' ') + ' -_metadata.lastUpdated';
			} else {
				sort = '-_metadata.lastUpdated';
			}
			let docs = await model.find(filter).select(select).sort(sort).skip(skip).limit(count).lean();
			if (req.query.expand) {
				let promises = docs.map(e => specialFields.expandDocument(req, e, null, true));
				docs = await Promise.all(promises);
				promises = null;
			}
			if (specialFields.secureFields && specialFields.secureFields.length && specialFields.secureFields[0]) {
				let promises = docs.map(e => specialFields.decryptSecureFields(req, e, null));
				await Promise.all(promises);
				promises = null;
			}
			res.status(200).json(docs);
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

router.get('/:id', (req, res) => {
	async function execute() {
		try {
			let doc = await model.findById(req.params.id).lean();
			if (!doc) {
				return res.status(404).json({
					message: `Record With ID  ${req.params.id} Not Found.`
				});
			}
			const expandLevel = (req.header('expand-level') || 0) + 1;
			if (req.query.expand && expandLevel < 3) {
				doc = await specialFields.expandDocument(req, doc);
			}
			if (specialFields.secureFields && specialFields.secureFields.length && specialFields.secureFields[0]) {
				await specialFields.decryptSecureFields(req, doc, null);
			}
			res.status(200).json(doc);
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

router.post('/', (req, res) => {
	async function execute() {
		// const workflowModel = global.authorDB.model('workflow');
		const workflowModel = mongoose.model('workflow');
		let txnId = req.get(global.txnIdHeader);
		try {
			let payload = req.body;
			let promises;
			const hasSkipReview = await workflowUtils.hasSkipReview(req);
			if ((workflowUtils.isWorkflowEnabled() && !hasSkipReview) || req.query.draft) {
				let wfItemStatus = 'Pending';
				if (req.query.draft) {
					wfItemStatus = 'Draft';
				}
				if (Array.isArray(payload)) {
					promises = payload.map(async (e) => {
						const wfItem = workflowUtils.getWorkflowItem(req, 'POST', e._id, wfItemStatus, e, null);
						const wfDoc = new workflowModel(wfItem);
						wfDoc._req = req;
						const status = await wfDoc.save();
						return {
							_workflow: status._id,
							message: 'Workflow has been created'
						};
					});
					promises = await Promise.all(promises);
				} else {
					const wfItem = workflowUtils.getWorkflowItem(req, 'POST', payload._id, wfItemStatus, payload, null);
					const wfDoc = new workflowModel(wfItem);
					wfDoc._req = req;
					const status = await wfDoc.save();
					promises = {
						_workflow: status._id,
						message: 'Workflow has been created'
					};
				}
				res.status(200).json(promises);
			} else {
				if (Array.isArray(payload)) {
					let abortOnError = req.query.abortOnError;
					if (abortOnError) {
						if (!global.isTransactionAllowed)
							throw new Error('Transactions are not supported for your Mongo Db server configuration.');
						logger.debug(`[${txnId}] :: Starting transaction for bulk post.`);
						let session;
						try {
							await mongoose.connection.transaction(async function saveRecords(sess) {
								session = sess;
								return createDocuments(req, session);
							}, config.transactionOptions)
						} catch(err) {
							logger.error(`[${txnId}] : Error while bulk post with transaction :: `, err);
							throw err;
						} finally {
							if(session) session.endSession();
						}
					} else {
						promises = await createDocuments(req);
					}
				} else {
					let upsert = req.query.upsert;
					if(upsert && payload._id) {
						let oldDoc = await model.findById(payload._id);
						logger.debug(`[${txnId}] : Updating Existing Record With ID ${payload._id}`);
						payload = _.mergeWith(oldDoc, payload, mergeCustomizer);
					}
					const doc = new model(payload);
					doc._req = req;
					promises = (await doc.save()).toObject();
				}
				res.status(200).json(promises);
			}
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

router.put('/:id', (req, res) => {
	async function execute() {
		// const workflowModel = global.authorDB.model('workflow');
		const workflowModel = mongoose.model('workflow');
		try {
			const upsert = req.query.upsert || false;
			let payload = req.body;
			let status;
			let isNewDoc = false;
			let doc = await model.findById(req.params.id);
			if (!doc && !upsert) {
				return res.status(404).json({
					message: 'Document Not Found'
				});
			}
			if (!doc && upsert) {
				isNewDoc = true;
				payload._id = req.params.id;
				payload._metadata = {};
				delete payload.__v;
				doc = new model(payload);
			}
			if (doc._metadata.workflow) {
				return res.status(400).json({
					message: 'This Document is Locked because of a pending Workflow'
				});
			}
			if (!isNewDoc) {
				delete payload._id;
				doc._oldDoc = doc.toObject();
			}
			doc._req = req;
			const hasSkipReview = await workflowUtils.hasSkipReview(req);
			if ((workflowUtils.isWorkflowEnabled() && !hasSkipReview) || req.query.draft) {
				let wfItemStatus = 'Pending';
				if (req.query.draft) {
					wfItemStatus = 'Draft';
				}
				const wfItem = workflowUtils.getWorkflowItem(req, isNewDoc ? 'POST' : 'PUT', doc._id, wfItemStatus, payload, isNewDoc ? null : doc._oldDoc);
				const wfDoc = new workflowModel(wfItem);
				wfDoc._req = req;
				status = await wfDoc.save();
				doc._metadata.workflow = status._id;
				status = await doc.save();
				return res.status(200).json({
					_workflow: doc._metadata.workflow,
					message: 'Workflow has been created'
				});
			} else {
				_.mergeWith(doc, payload, mergeCustomizer);
				status = await doc.save();
				return res.status(200).json(status);
			}
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

router.delete('/:id', (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	async function execute() {
		// const workflowModel = global.authorDB.model('workflow');
		const workflowModel = mongoose.model('workflow');
		try {
			let doc = await model.findById(req.params.id);
			let status;
			if (!doc) {
				return res.status(404).json({
					message: `Record With ID  ${req.params.id} Not Found`
				});
			}
			if (doc._metadata.workflow) {
				return res.status(400).json({
					message: 'This Document is Locked because of a pending Workflow'
				});
			}
			doc._req = req;
			doc._oldDoc = doc.toObject();
			const hasSkipReview = await workflowUtils.hasSkipReview(req);
			if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
				const wfItem = workflowUtils.getWorkflowItem(req, 'DELETE', doc._id, 'Pending', null, doc.toObject());
				const wfDoc = new workflowModel(wfItem);
				wfDoc._req = req;
				status = await wfDoc.save();
				doc._metadata.workflow = status._id;
				status = await doc.save();
			} else {
				if (!config.permanentDelete) {
					let softDeletedDoc = softDeletedModel(doc);
					await softDeletedDoc.save();
				}
				status = await doc.remove();
			}
			logger.trace(`[${txnId}] Delete doc :: ${req.params.id} :: ${status}`);
			res.status(200).json({
				message: 'Document Deleted'
			});
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

router.put('/:id/math', (req, res) => {
	async function execute() {
		try {
			mathQueue.push({ req, res });
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

// WHAT is THIS?
router.post('/hook', (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	async function execute() {
		try {
			const url = req.query.url;
			const data = req.body;
			if (!url) {
				return res.status(400).json({
					message: 'URL is Mandatory'
				});
			}
			try {
				const httpRes = await hooksUtils.invokeHook(txnId, url, data);
				res.status(200).json(httpRes);
			} catch (e) {
				res.status(400).json({
					message: e.message
				});
			}
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	});
});

async function createDocuments(req, session) {
	const payload = req.body;
	let upsert = req.query.upsert;
	let oldDocs = [];
	let oldIds = [];
	let txnId = req.get(global.txnIdHeader);
	if(upsert) {
		var newIds = payload.map(data => data._id).filter(_id => _id);
		oldDocs = await model.find({_id : { $in : newIds }});
		oldIds = oldDocs.map(data => data._id);
		logger.debug(`[${txnId}] : Existing Record Ids :: `, oldIds);
	}
	promises = payload.map(async (data) => {
		if(upsert && data._id && oldIds.includes(data._id)) {
			let oldDoc = oldDocs.find(doc => doc._id == data._id);
			data = _.mergeWith(oldDoc, data, mergeCustomizer);
		}
		let doc = new model(data);
		doc._req = req;
		if(session) {
			return (await doc.save({ session })).toObject();
		} else {
			try {
				return (await doc.save()).toObject();
			} catch (e) {
				logger.error(`[${txnId}] : Error in creating record :: `, e);
				return { message: e.message };
			}
		}
	});
	return await Promise.all(promises);
}

function addAuthHeader(paths, jwt) {
	Object.keys(paths).forEach(path => {
		Object.keys(paths[path]).forEach(method => {
			if (typeof paths[path][method] == 'object' && paths[path][method]['parameters']) {
				let authObj = paths[path][method]['parameters'].find(obj => obj.name == 'authorization');
				if (authObj) authObj.default = jwt;
			}
		});
	});
}

/******************************* Math API Logic *************************/

function processMathQueue(obj, cb) {
	obj.req.simulateFlag = false;
	let webHookData = null;
	let id = obj.req.params.id;
	let resData = null;
	obj.req.query.source = 'presave';
	obj.req.simulate = false;
	return doRoundMathAPI(obj.req, obj.res)
		.then(resBody => {
			resData = resBody;
			obj.res.json(resBody);
			cb();
		})
		.then(() => {
			return getWebHookAndAuditData(obj.req, id, false);
		})
		.then(_d => {
			webHookData = _d;
			pushWebHookAndAuditData(webHookData, resData);
		})
		.catch(err => {
			logger.error(err.message);
			cb();
			if (err.message == 'CUSTOM_READ_CONFLICT' || (err.errmsg === 'WriteConflict' && err.errorLabels && err.errorLabels.indexOf('TransientTransactionError') > -1)) {
				logger.error('=================');
				obj.req.simulateFlag = true;
				if (!obj.res.headersSent) {
					mathQueue.push({ req: obj.req, res: obj.res });
				}
			} else {
				let status = err.name == 'ValidationError' ? 400 : 500;
				obj.res.status(status).json({ message: err.message });
			}
		});
}

function getWebHookAndAuditData(req, id, isNew) {
	let data = {};
	data.serviceId = id;
	data.operation = req.method;
	data.user = req.headers[global.userHeader];
	data.txnId = req.headers[global.txnIdHeader];
	data.timeStamp = new Date();
	data.data = {};
	if (id) {
		let promise = isNew ? Promise.resolve(null) : model.findOne({ _id: id });
		return promise
			.then(doc => {
				if (doc) {
					data.operation = data.operation == 'DELETE' ? data.operation : 'PUT';
					data.data.old = JSON.stringify(doc.toJSON());
				}
				else {
					data.data.old = null;
				}
				return data;
			});
	}
	return Promise.resolve(data);
}

function pushWebHookAndAuditData(webHookData, newData) {
	webHookData._id = newData._id;
	webHookData.data.new = JSON.stringify(newData);
	queue.sendToQueue(webHookData);
	let auditData = {};
	auditData.versionValue = '-1';
	auditData.user = webHookData.user;
	auditData.txnId = webHookData.txnId;
	auditData.timeStamp = webHookData.timeStamp;
	auditData.data = {};
	auditData.data.old = {};
	auditData.data.new = {};
	auditData._metadata = {};
	auditData.colName = 'Adam.complex.audit';
	auditData._metadata.lastUpdated = new Date();
	auditData._metadata.createdAt = new Date();
	auditData._metadata.deleted = false;
	auditData.data._id = JSON.parse(webHookData.data.new)._id;
	auditData.data._version = JSON.parse(webHookData.data.new)._metadata.version.document;
	getDiff(JSON.parse(webHookData.data.old), JSON.parse(webHookData.data.new), auditData.data.old, auditData.data.new);
	let oldLastUpdated = auditData.data.old && auditData.data.old._metadata ? auditData.data.old._metadata.lastUpdated : null;
	let newLastUpdated = auditData.data.new && auditData.data.new._metadata ? auditData.data.new._metadata.lastUpdated : null;
	if (oldLastUpdated) delete auditData.data.old._metadata.lastUpdated;
	if (newLastUpdated) delete auditData.data.new._metadata.lastUpdated;

	if (!_.isEqual(auditData.data.old, auditData.data.new)) {
		if (oldLastUpdated) auditData.data.old._metadata.lastUpdated = oldLastUpdated;
		if (newLastUpdated) auditData.data.new._metadata.lastUpdated = newLastUpdated;
		if (auditData.versionValue != 0) {
			client.publish('auditQueue', JSON.stringify(auditData));
		}

	}
}

function getUpdatedDoc(doc, updateObj) {
	Object.keys(updateObj).forEach(_k => {
		let keyArr = _k.split('.');
		keyArr.reduce((acc, curr, i) => {
			if (i == keyArr.length - 1) {
				acc[curr] = updateObj[_k];
			}
			if (acc) {
				return acc[curr];
			}
		}, doc);
	});
}

function doRoundMathAPI(req) {
	let id = req.params.id;
	let body = req.body;
	let updateBody = { '$inc': { '_metadata.version.document': 1 } };
	let session = null;
	let resBody = null;
	let prevVersion = null;
	let promise = Promise.resolve();
	if (body['$inc']) {
		promise = Object.keys(body['$inc']).reduce((acc, curr) => {
			return acc.then(() => {
				let pField = specialFields.precisionFields.find(_p => _p.field == curr);
				if (pField && (pField.precision || pField.precision == 0)) {
					return roundMath(id, session, body['$inc'][curr], '$add', curr, pField.precision, prevVersion)
						.then(_val => {
							logger.debug({ _val });
							if (_val) {
								prevVersion = _val.prevVersion;
								if (!updateBody['$set']) {
									updateBody['$set'] = {};
								}
								updateBody['$set'][curr] = _val.val;
							}
							return Promise.resolve();
						});
				} else {
					if (!updateBody['$inc']) {
						updateBody['$inc'] = {};
					}
					updateBody['$inc'][curr] = body['$inc'][curr];
					return Promise.resolve();
				}
			});
		}, promise);
	}
	if (body['$mul']) {
		promise = Object.keys(body['$mul']).reduce((acc, curr) => {
			return acc.then(() => {
				let pField = specialFields.precisionFields.find(_p => _p.field == curr);
				if (pField && (pField.precision || pField.precision == 0)) {
					return roundMath(id, session, body['$mul'][curr], '$multiply', curr, pField.precision, prevVersion)
						.then(_val => {
							if (_val) {
								prevVersion = _val.prevVersion;
								if (!updateBody['$set']) {
									updateBody['$set'] = {};
								}
								updateBody['$set'][curr] = _val.val;
							}
							return Promise.resolve();
						});
				} else {
					if (!updateBody['$mul']) {
						updateBody['$mul'] = {};
					}
					updateBody['$mul'][curr] = body['$mul'][curr];
					return Promise.resolve();
				}
			});
		}, promise);
	}
	const opts = { new: true };
	let generateId = false;
	let globalDoc = null;
	return promise.then(() => {
		if (updateBody['$set']) {
			return model.findOne({ _id: id })
				.then((_doc) => {
					getUpdatedDoc(_doc, updateBody['$set']);
					globalDoc = _doc;
					return _doc.validate();
				})
				.then(() => {
					if (!req.simulateFlag)
						return workflowUtils.simulate(req, globalDoc, { generateId, operation: 'PUT' });
					return globalDoc;
				})
				.then((_d) => {
					logger.debug({ _id: id, '_metadata.version.document': prevVersion });
					return model.findOneAndUpdate({ _id: id, '_metadata.version.document': prevVersion }, _d, opts);
				});
		}
	}).then(_newBody => {
		resBody = _newBody;
		if (!_newBody) {
			logger.debug({ _newBody });
			throw new Error('CUSTOM_READ_CONFLICT');
		}
		logger.debug(JSON.stringify({ resBody }));
	}).then(() => {
		return resBody;
	});
}

function roundMath(id, session, value, operation, field, precision, prevVersion) {
	let precisionFactor = Math.pow(10, precision);
	return model.aggregate([
		{ $match: { _id: id } },
		{
			$project: {
				_id: 0,
				docVersion: '$_metadata.version.document',
				y: {
					$divide: [
						{
							$subtract: [
								{
									$add: [{ $multiply: [{ [operation]: [`$${field}`, value] }, precisionFactor] }, 0.5]
								},
								{
									$abs: { $mod: [{ $add: [{ $multiply: [{ [operation]: [`$${field}`, value] }, precisionFactor] }, 0.5] }, 1] }
								}
							]
						}, precisionFactor]
				}
			}
		}
	]).then(_a => {
		logger.debug(JSON.stringify({ _a, prevVersion }));
		if (!_a || !_a[0]) {
			throw new Error('Document not found');
		}
		if (_a && _a[0] && (prevVersion || prevVersion == 0) && prevVersion != _a[0]['docVersion']) {
			throw new Error('CUSTOM_READ_CONFLICT');
		}
		if (_a && _a[0]) {
			prevVersion = _a[0]['docVersion'];
		}
		logger.debug('new ' + JSON.stringify({ _a, prevVersion }));
		return _a && _a[0] && (_a[0].y || _a[0].y === 0) ? { val: parseFloat(_a[0].y.toFixed(precision)), prevVersion } : null;
	});
}

module.exports = router;