const router = require('express').Router();
const mongoose = require('mongoose');
const log4js = require('log4js');
const swaggerParser = require('swagger-parser');
const async = require('async');
const _ = require('lodash');
const { flatten } = require('@appveen/utils/objectUtils');
const sift = require('sift');

const config = require('../../config');
const specialFields = require('../utils/special-fields.utils');
const hooksUtils = require('../utils/hooks.utils');
const crudderUtils = require('../utils/crudder.utils');
const workflowUtils = require('../utils/workflow.utils');
const transactionUtils = require('../utils/transaction.utils');
const {
	mergeCustomizer,
	getDiff,
	modifySecureFieldsFilter,
} = require('./../utils/common.utils');
const serviceData = require('../../service.json');

const logger = log4js.getLogger(global.loggerName);

const model = mongoose.model(config.serviceId);
let softDeletedModel;
if (!config.permanentDelete)
	softDeletedModel = mongoose.model(config.serviceId + '.deleted');
const mathQueue = async.priorityQueue(processMathQueue);

router.get('/doc', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	try {
		if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			return res.status(403).json({
				message: 'You don\'t have permission to fetch documentation',
			});
		}
		const obj = await swaggerParser.parse('../swagger/swagger.yaml');
		obj.host = req.query.host;
		obj.basePath = req.query.basePath ? req.query.basePath : obj.basePath;
		addAuthHeader(obj.paths, req.query.token);
		res.status(200).json(obj);
	} catch (err) {
		handleError(res, err, txnId);
	}
});

router.get('/utils/securedFields', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	try {
		if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			return res.status(403).json({
				message: 'You don\'t have permission to fetch secure fields',
			});
		}
		res.status(200).json(specialFields.secureFields);
	} catch (err) {
		handleError(res, err, txnId);
	}
});

router.get('/utils/bulkShow', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	try {
		if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			return res.status(403).json({
				message: 'You don\'t have permission to fetch records',
			});
		}
		let ids = req.query.ids || req.query.id;
		if (ids && _.trim(ids)) {
			ids = ids.split(',');
		} else {
			ids = [];
		}

		const filter = {
			_id: {
				$in: ids,
			},
			'_metadata.deleted': false,
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
		docs.forEach(doc => specialFields.filterByPermission(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []), doc));
		docs.forEach((doc) => {
			delete doc._metadata._id;
			delete doc._metadata.version._id;
		});
		res.status(200).json(docs);
	} catch (err) {
		handleError(res, err, txnId);
	}
});

router.put('/utils/bulkUpdate', async (req, res) => {
	const id = req.query.ids || req.query.id;
	const ids = (id || '').split(',');
	const userFilter = req.query.filter;
	if ((!ids || ids.length == 0) && (!userFilter || _.isEmpty(userFilter))) {
		return res.status(400).json({
			message: 'Invalid Request, Not sure which all records to update',
		});
	}
	if (!specialFields.hasPermissionForPUT(req, req.user.appPermissions)) {
		return res.status(403).json({
			message: 'You don\'t have permission to update records',
		});
	}
	if (req.query.txn == true) {
		return transactionUtils.transferToTransaction(req, res);
	}
	try {
		addExpireAt(req);
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}

	let txnId = req.get(global.txnIdHeader);
	const workflowModel = mongoose.model('workflow');
	try {
		let filter = {
			'_metadata.deleted': false,
		};
		if (ids && ids.length > 0) {
			filter['_id'] = {
				$in: ids,
			};
		} else {
			filter = _.merge(filter, userFilter);
		}
		const docs = await model.find(filter);
		const promises = docs.map(async (doc) => {
			doc._req = req;
			doc._oldDoc = doc.toObject();
			const payload = doc.toObject();
			_.mergeWith(payload, req.body, mergeCustomizer);
			const hasSkipReview = workflowUtils.hasAdminAccess(req, req.user.appPermissions);
			if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
				const wfItem = workflowUtils.getWorkflowItem(
					req,
					'PUT',
					doc._id,
					'Pending',
					payload,
					doc.toObject()
				);
				const wfDoc = new workflowModel(wfItem);
				wfDoc._req = req;
				let status = await wfDoc.save();
				doc._metadata.workflow = status._id;
				return await model.findByIdAndUpdate(doc._id, {
					'_metadata.workflow': status._id,
				});
			} else {
				_.mergeWith(doc, req.body, mergeCustomizer);
				return new Promise((resolve) => {
					doc.save().then(resolve).catch(resolve);
				});
			}
		});
		const allResult = await Promise.all(promises);
		if (allResult.every((e) => e._id)) {
			return res.status(200).json(allResult);
		} else if (allResult.every((e) => !e._id)) {
			return res.status(400).json(allResult);
		} else {
			return res.status(207).json(allResult);
		}
	} catch (err) {
		logger.error(err);
		handleError(res, err, txnId);
		// res.status(400).json({
		// 	message: err.message,
		// });
	}
});

router.post('/utils/bulkUpsert', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	let update = req.query.update || 'false';
	let insert = req.query.insert || 'false';
	if (typeof update == 'string' && _.lowerCase(update) == 'false') {
		update = false;
	} else {
		update = true;
	}
	if (typeof insert == 'string' && _.lowerCase(insert) == 'false') {
		insert = false;
	} else {
		insert = true;
	}
	let keys = req.body.keys;
	const allDocs = req.body.docs;
	if (!keys || !Array.isArray(keys) || keys.length == 0) {
		keys = ['_id'];
	}
	const idIndex = keys.indexOf('_id');
	if (idIndex > -1) {
		keys = keys.splice(idIndex, 1);
	}
	if (!allDocs || allDocs.length == 0) {
		return res.status(400).json({
			message: 'Invalid Request, No documents to updated',
		});
	}

	if (insert && !specialFields.hasPermissionForPOST(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		return res.status(403).json({
			message: 'You don\'t have permission to insert records',
		});
	}
	if (update && !specialFields.hasPermissionForPUT(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		return res.status(403).json({
			message: 'You don\'t have permission to update records',
		});
	}

	const dynamicFilter = await specialFields.getDynamicFilter(req);
	if (!_.isEmpty(dynamicFilter)) {
		const tester = sift(dynamicFilter);
		if (Array.isArray(allDocs)) {
			const testedPayload = allDocs.filter(tester);
			if (testedPayload.length != allDocs.length) {
				logger.warn(`[${txnId}] Dynamic Filter, Forbidden Payload`);
				return res.status(400).json({ message: 'You don\'t have access for this operation.' });
			}
		} else {
			if (!tester(allDocs)) {
				logger.warn(`[${txnId}] Dynamic Filter, Forbidden Payload`);
				return res.status(400).json({ message: 'You don\'t have access for this operation.' });
			}
		}
	}

	if (req.query.txn == true) {
		return transactionUtils.transferToTransaction(req, res);
	}

	const workflowModel = mongoose.model('workflow');

	try {
		let filter = {
			'_metadata.deleted': false,
		};
		let promises = allDocs.map(async (data) => {
			const keyValPairs = keys.map(key => {
				const val = _.get(data, key);
				if (val) {
					return { [key]: val };
				}
				return null;
			}).filter(e => e);
			let tempFilter;
			if (_.isEmpty(keyValPairs)) {
				tempFilter = {};
			} else {
				tempFilter = Object.assign.apply({}, keyValPairs);
			}
			if (_.isEmpty(tempFilter)) {
				if (!insert) {
					return {
						message: 'Cannot update without a filter/key',
					};
				} else {
					return await insertOperation(data);
				}
			} else {
				_.merge(tempFilter, filter);
				const dbDoc = await model.findOne(tempFilter);
				if (dbDoc && !_.isEmpty(dbDoc)) {
					if (!update) {
						return {
							message: 'Document already exists',
						};
					} else {
						return await updateOperation(data, dbDoc);
					}
				} else {
					if (!insert) {
						return {
							message: 'Document not found',
						};
					} else {
						return await insertOperation(data);
					}
				}
			}
		});
		let allResult = await Promise.all(promises);
		if (allResult.every((e) => e._id || e._workflow)) {
			return res.status(200).json(allResult);
		} else if (allResult.every((e) => !e._id && !e._workflow)) {
			return res.status(400).json(allResult);
		} else {
			return res.status(207).json(allResult);
		}
	} catch (e) {
		handleError(res, e, txnId);
	}

	async function insertOperation(data) {
		const doc = new model(data);
		doc._req = req;
		const hasSkipReview = workflowUtils.hasAdminAccess(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []));
		if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
			const wfItem = workflowUtils.getWorkflowItem(req, 'POST', doc._id, 'Pending', data, null);
			const wfDoc = new workflowModel(wfItem);
			wfDoc._req = req;
			let status = await wfDoc.save();
			return {
				_workflow: status._id,
				message: 'Workflow has been created',
			};
		} else {
			return await doc.save();
			// return (await new Promise((resolve) => {
			// 	doc.save().then(resolve).catch(resolve);
			// })).toObject();
		}
	}

	async function updateOperation(data, dbDoc) {
		dbDoc._req = req;
		dbDoc._oldDoc = dbDoc.toObject();
		const payload = dbDoc.toObject();
		_.mergeWith(payload, data, mergeCustomizer);
		const hasSkipReview = workflowUtils.hasAdminAccess(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []));
		if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
			const wfItem = workflowUtils.getWorkflowItem(req, 'PUT', dbDoc._id, 'Pending', payload, dbDoc.toObject());
			const wfDoc = new workflowModel(wfItem);
			wfDoc._req = req;
			let status = await wfDoc.save();
			dbDoc._metadata.workflow = status._id;
			await model.findByIdAndUpdate(dbDoc._id, {
				'_metadata.workflow': status._id,
			});
			return {
				_workflow: status._id,
				message: 'Workflow has been created',
			};
		} else {
			dbDoc = _.mergeWith(dbDoc, data, mergeCustomizer);
			return await dbDoc.save();
			// return (await new Promise((resolve) => {
			// 	dbDoc.save().then(resolve).catch(resolve);
			// }));
		}
	}

});

router.delete('/utils/bulkDelete', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	let ids = req.query.ids || req.body.ids || req.query.id || req.body.id;
	const userFilter = req.query.filter || req.body.filter;
	if ((!ids || ids.length == 0) && (!userFilter || _.isEmpty(userFilter))) {
		return res.status(400).json({
			message: 'Invalid Request, Not sure what to delete',
		});
	}
	if (!specialFields.hasPermissionForDELETE(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		return res.status(403).json({
			message: 'You don\'t have permission to delete records',
		});
	}

	if (ids && typeof ids === 'string') {
		ids = ids.split(',');
	}

	if (req.query.txn == true) {
		return transactionUtils.transferToTransaction(req, res);
	}
	// const workflowModel = global.authorDB.model('workflow');

	const workflowModel = mongoose.model('workflow');
	try {
		let filter = {
			'_metadata.deleted': false,
		};
		if (ids && ids.length > 0) {
			filter['_id'] = {
				$in: ids,
			};
		} else {
			filter = _.merge(filter, JSON.parse(userFilter));
		}
		if (!serviceData.schemaFree) {
			const dynamicFilter = await specialFields.getDynamicFilter(req);
			if (dynamicFilter && !_.isEmpty(dynamicFilter)) {
				filter = { $and: [filter, dynamicFilter] };
			}
		}
		const docs = await model.find(filter);
		const promises = docs.map(async (doc) => {
			doc._req = req;
			doc._oldDoc = doc.toObject();
			const hasSkipReview = workflowUtils.hasAdminAccess(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []));
			if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
				const wfItem = workflowUtils.getWorkflowItem(
					req,
					'DELETE',
					doc._id,
					'Pending',
					null,
					doc.toObject()
				);
				wfItem.audit[0].remarks = req.body.remarks;
				const wfDoc = new workflowModel(wfItem);
				wfDoc._req = req;
				let status = await wfDoc.save();
				doc._metadata.workflow = status._id;
				return await model.findByIdAndUpdate(doc._id, {
					'_metadata.workflow': status._id,
				});
			} else {
				if (!config.permanentDelete) {
					let softDeletedDoc = new softDeletedModel(doc);
					softDeletedDoc.isNew = true;
					await softDeletedDoc.save();
				}
				return new Promise((resolve) => {
					doc
						.remove()
						.then(resolve)
						.catch(() => resolve(null));
				});
			}
		});
		const allResult = await Promise.all(promises);
		const removedIds = allResult
			.filter((doc) => doc != null)
			.map((doc) => doc._id);
		const docsNotRemoved = _.difference(_.uniq(ids), removedIds);
		if (_.isEmpty(docsNotRemoved)) {
			return res.status(200).json({
				message: `${removedIds.length} record(s) deleted successfully.`,
			});
		} else {
			return res.status(400).json({
				message: 'Could not delete document with id ' + docsNotRemoved,
			});
		}
	} catch (e) {
		handleError(res, e, txnId);
	}
});


/**
 * @deprecated
 */
router.get('/utils/count', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	try {
		let filter = {};
		let errors = {};
		try {
			if (req.query.filter) {
				filter = JSON.parse(decodeURIComponent(req.query.filter));

				const tempFilter = await specialFields.patchRelationInFilter(
					req,
					filter,
					errors
				);
				if (Array.isArray(tempFilter) && tempFilter.length > 0) {
					filter = tempFilter[0];
				} else if (tempFilter) {
					filter = tempFilter;
				}
				filter = modifySecureFieldsFilter(
					filter,
					specialFields.secureFields,
					false
				);
			}
		} catch (e) {
			logger.error(e);
			return res.status(400).json({
				message: e,
			});
		}
		if (filter) {
			filter = crudderUtils.parseFilter(filter);
		}
		if (errors && Object.keys(errors).length > 0) {
			logger.warn('Error while fetching relation: ', JSON.stringify(errors));
		}
		if (!serviceData.schemaFree) {
			const dynamicFilter = await specialFields.getDynamicFilter(req);
			if (dynamicFilter && !_.isEmpty(dynamicFilter)) {
				filter = { $and: [filter, dynamicFilter] };
			}
		}
		const count = await model.countDocuments(filter);
		res.status(200).json(count);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.get('/', async (req, res) => {
	let txnId = req.get('txnId');
	try {
		let filter = {};
		let errors = {};
		if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			logger.error(`[${txnId}] User does not have permission to fetch records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
			return res.status(403).json({
				message: 'You don\'t have permission to fetch records',
			});
		}
		try {
			logger.trace(`[${txnId}] Schema free ? ${serviceData.schemaFree}`);
			logger.trace(`[${txnId}] Filter ${decodeURIComponent(req.query.filter)}`);
			logger.trace(`[${txnId}] Sort ${req.query.sort}`);
			logger.trace(`[${txnId}] Select ${req.query.select}`);
			logger.trace(`[${txnId}] Skip ${req.query.skip}`);
			logger.trace(`[${txnId}] Limit ${req.query.limit}`);

			if (req.query.filter) {
				filter = JSON.parse(decodeURIComponent(req.query.filter));
				let tempFilter;
				if (!serviceData.schemaFree) {
					tempFilter = await specialFields.patchRelationInFilter(
						req,
						filter,
						errors
					);
				}

				if (Array.isArray(tempFilter) && tempFilter.length > 0) {
					filter = tempFilter[0];
				} else if (tempFilter) {
					filter = tempFilter;
				}

				if (!serviceData.schemaFree) {
					filter = modifySecureFieldsFilter(
						filter,
						specialFields.secureFields,
						false
					);
				}
			}
		} catch (e) {
			logger.error(e);
			return res.status(400).json({
				message: e,
			});
		}
		if (filter) {
			filter = crudderUtils.parseFilter(filter);
		}

		if (errors && Object.keys(errors).length > 0) {
			logger.warn('Error while fetching relation: ', JSON.stringify(errors));
		}
		if (!serviceData.schemaFree) {
			const dynamicFilter = await specialFields.getDynamicFilter(req);
			if (dynamicFilter && !_.isEmpty(dynamicFilter)) {
				filter = { $and: [filter, dynamicFilter] };
			}
		}
		if (req.query.countOnly) {
			const count = await model.countDocuments(filter);
			return res.status(200).json(count);
		}
		let skip = 0;
		let count = 30;
		let select = '';
		let sort = '';
		if (req.query.count && +req.query.count > 0) {
			count = +req.query.count;
		} else if (req.query.count == -1 && config.ODP_RULES) {
			count = -1;
		}

		if (req.query.page && +req.query.page > 0) {
			skip = count * (+req.query.page - 1);
		}

		if (req.query.select && req.query.select.trim()) {
			try {
				let querySelect = JSON.parse(req.query.select);
				Object.keys(querySelect).forEach(key => {
					if (parseInt(querySelect[key]) == 1) {
						select += `${key} `;
					} else if (parseInt(querySelect[key]) == 0) {
						select += `-${key} `;
					} else {
						logger.error(`Invalid value for key :: ${key} :: ${querySelect[key]}`);
						throw new Error(`Invalid value for key :: ${key} :: ${querySelect[key]}`);
					}
				});
				select = select.trim();
			} catch (err) {
				if (err.message.indexOf('Invalid value for key') > -1) {
					throw err;
				} else {
					select = req.query.select.split(',').join(' ');
				}
			}
		}
		if (req.query.sort && req.query.sort.trim()) {
			try {
				let querySort = JSON.parse(req.query.sort);
				Object.keys(querySort).forEach(key => {
					if (parseInt(querySort[key]) == 1) {
						sort += `${key} `;
					} else if (parseInt(querySort[key]) == -1) {
						sort += `-${key} `;
					} else {
						logger.error(`Invalid value for key :: ${key} :: ${querySort[key]}`);
						throw new Error(`Invalid value for key :: ${key} :: ${querySort[key]}`);
					}
				});
				sort += ' -_metadata.lastUpdated';
			} catch (err) {
				if (err.message.indexOf('Invalid value for key') > -1) {
					throw err;
				} else {
					sort = req.query.sort.split(',').join(' ') + ' -_metadata.lastUpdated';
				}
			}
		} else {
			sort = '-_metadata.lastUpdated';
		}

		logger.trace(`[${txnId}] Final filter ${JSON.stringify(filter)}`);
		logger.trace(`[${txnId}] Final Sorter ${JSON.stringify(sort)}`);
		logger.trace(`[${txnId}] Final Select ${JSON.stringify(select)}`);
		logger.trace(`[${txnId}] Final Skip ${JSON.stringify(skip)}`);
		logger.trace(`[${txnId}] Final Limit ${JSON.stringify(count)}`);

		let query = model.find(filter);
		if (select) {
			query = query.select(select);
		}
		if (sort) {
			query = query.sort(sort);
		}
		if (count > 0) {
			if (skip) {
				query = query.skip(skip);
			}
			query = query.limit(count);
		}
		let docs = await query.lean();

		if (!serviceData.schemaFree) {
			docs.forEach((doc) => specialFields.filterByPermission(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []), doc));
			docs.forEach((doc) => {
				delete doc._metadata?._id;
				delete doc._metadata?.version?._id;
			});
			if (req.query.expand == true || req.query.expand == 'true') {
				let promises = docs.map((e) =>
					specialFields.expandDocument(req, e, null, true)
				);
				docs = await Promise.all(promises);
				promises = null;
			}
			if (
				specialFields.secureFields &&
				specialFields.secureFields.length &&
				specialFields.secureFields[0] &&
				(req.query.decrypt == true || req.query.decrypt == 'true')
			) {
				let promises = docs.map((e) => specialFields.decryptSecureFields(req, e, null));
				await Promise.all(promises);
				promises = null;
			}
		}
		res.status(200).json(docs);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.get('/:id', async (req, res) => {
	let txnId = req.get('txnId');
	let select = '';

	try {
		let id = req.params.id;
		logger.debug(`[${txnId}] Get request received for ${id}`);

		if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			logger.error(`[${txnId}] User does not have permission to fetch records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
			return res.status(403).json({
				message: 'You don\'t have permission to fetch a record',
			});
		}

		if (req.query.select && req.query.select.trim()) {
			select = req.query.select.split(',').join(' ');
		}

		let doc = await model
			.findById(id)
			.select(select)
			.lean();
		logger.trace(`[${txnId}] Document from DB ${JSON.stringify(doc)}`);
		if (!doc) {
			return res.status(404).json({
				message: `Record With ID ${id} Not Found.`,
			});
		}

		if (!serviceData.schemaFree) {
			specialFields.filterByPermission(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []), doc);
			const expandLevel = (req.header('expand-level') || 0) + 1;
			if ((req.query.expand == true || req.query.expand == 'true') && expandLevel < 3) {
				doc = await specialFields.expandDocument(req, doc);
			}
			if (
				specialFields.secureFields &&
				specialFields.secureFields.length &&
				specialFields.secureFields[0] &&
				(req.query.decrypt == true || req.query.decrypt == 'true')
			) {
				await specialFields.decryptSecureFields(req, doc, null);
			}
		}
		delete doc._metadata?._id;
		delete doc._metadata?.version?._id;
		res.status(200).json(doc);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.post('/', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	let id = req.params.id;
	let payload = req.body;
	let upsert = req.query.upsert || false;

	const errors = await specialFields.validateDateFields(req, payload, null);
	if (errors && !_.isEmpty(errors)) {
		let txnId = req.headers['txnId'];
		logger.error(`[${txnId}] Error in validation date fields :: `, errors);
		return res.status(400).json({ message: 'Error in validation date fields', errors });
	}
	logger.trace(`[${txnId}] Payload after date field validation`, payload);

	logger.debug(`[${txnId}] Create request received.`);
	if (!serviceData.schemaFree) {
		const dynamicFilter = await specialFields.getDynamicFilter(req);
		if (!_.isEmpty(dynamicFilter)) {
			const tester = sift(dynamicFilter);
			if (Array.isArray(payload)) {
				const testedPayload = payload.filter(tester);
				if (testedPayload.length != payload.length) {
					logger.warn(`[${txnId}] Dynamic Filter, Forbidden Payload`);
					return res.status(400).json({ message: 'You don\'t have access for this operation.' });
				}
			} else {
				if (!tester(payload)) {
					logger.warn(`[${txnId}] Dynamic Filter, Forbidden Payload`);
					return res.status(400).json({ message: 'You don\'t have access for this operation.' });
				}
			}
		}
	}
	if (req.query.txn == true) {
		logger.debug(`[${txnId}] Create request is a part of a transaction ${id}`);
		return transactionUtils.transferToTransaction(req, res);
	}
	try {
		addExpireAt(req);
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}
	if (upsert) {
		if (!specialFields.hasPermissionForPOST(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))
			&& !specialFields.hasPermissionForPUT(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			logger.error(`[${txnId}] User does not have permission to Create/Upsert records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
			return res.status(403).json({
				message: 'You don\'t have permission to Create/Upsert records',
			});
		}
	} else {
		if (!specialFields.hasPermissionForPOST(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			logger.error(`[${txnId}] User does not have permission to create records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
			return res.status(403).json({
				message: 'You don\'t have permission to create records',
			});
		}
	}

	const workflowModel = mongoose.model('workflow');

	try {
		let promises;
		const hasSkipReview = workflowUtils.hasAdminAccess(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []));

		if (workflowUtils.isWorkflowEnabled()) logger.debug(`[${txnId}] Is workflow enabled? ${workflowUtils.isWorkflowEnabled()}`);
		if (hasSkipReview) logger.debug(`[${txnId}] has Skip Review permission? ${hasSkipReview}`);
		logger.trace(`[${txnId}] Payload ${JSON.stringify(payload)}`);


		if (
			(workflowUtils.isWorkflowEnabled() && !hasSkipReview) ||
			req.query.draft
		) {
			let wfItemStatus = 'Pending';
			if (req.query.draft) {
				wfItemStatus = 'Draft';
			}
			if (Array.isArray(payload)) {
				promises = payload.map(async (e) => {
					const wfItem = workflowUtils.getWorkflowItem(
						req,
						'POST',
						e._id,
						wfItemStatus,
						e,
						null
					);
					const doc = new model(e);
					await doc.validate();
					const wfDoc = new workflowModel(wfItem);
					wfDoc._req = req;
					const status = await wfDoc.save();
					return {
						_workflow: status._id,
						message: 'Workflow has been created',
					};
				});
				promises = await Promise.all(promises);
			} else {
				const wfItem = workflowUtils.getWorkflowItem(
					req,
					'POST',
					payload._id,
					wfItemStatus,
					payload,
					null
				);
				const doc = new model(payload);
				await doc.validate();
				const wfDoc = new workflowModel(wfItem);
				wfDoc._req = req;
				const status = await wfDoc.save();
				promises = {
					_workflow: status._id,
					message: 'Workflow has been created',
				};
			}
			res.status(200).json(promises);
		} else {
			if (Array.isArray(payload)) {
				promises = payload.map(async (data) => {
					if (!serviceData.schemaFree && serviceData.stateModel && serviceData.stateModel.enabled && !hasSkipReview) {
						if (!_.get(data, serviceData.stateModel.attribute)) {
							_.set(data, serviceData.stateModel.attribute, serviceData.stateModel.initialStates[0]);
						}

						if (!serviceData.stateModel.initialStates.includes(_.get(data, serviceData.stateModel.attribute))) {
							return { message: 'Record is not in initial state.' };
						}
					}
					let doc;
					if (data._id) {
						doc = await model.findOne({ _id: data._id });
					}
					if (doc) {
						_.mergeWith(doc, data, mergeCustomizer);
					} else {
						doc = new model(data);
					}
					doc._req = req;
					try {
						return (await doc.save()).toObject();
					} catch (e) {
						logger.error(`[${txnId}] : Error while inserting record :: `, e);
						return { message: e.message };
					}
				});
				promises = await Promise.all(promises);
				promises.forEach((doc) => {
					delete doc._metadata?._id;
					delete doc._metadata?.version?._id;
				});
			} else {
				if (!serviceData.schemaFree && serviceData.stateModel && serviceData.stateModel.enabled && !hasSkipReview) {
					if (!_.get(payload, serviceData.stateModel.attribute)) {
						_.set(payload, serviceData.stateModel.attribute, serviceData.stateModel.initialStates[0]);
					}

					if (!serviceData.stateModel.initialStates.includes(_.get(payload, serviceData.stateModel.attribute))) {
						throw new Error('Record is not in initial state.');
					}
				}
				let doc;
				if (payload._id) {
					doc = await model.findOne({ _id: payload._id });
				}
				if (doc) {
					_.mergeWith(doc, payload, mergeCustomizer);
				} else {
					doc = new model(payload);
				}
				doc._req = req;
				promises = (await doc.save()).toObject();
				delete promises._metadata?._id;
				delete promises._metadata?.version?._id;
			}
			res.status(200).json(promises);
		}
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.put('/:id', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	const upsert = req.query.upsert == 'true';
	let payload = req.body;

	let errors = await specialFields.validateDateFields(req, payload, null) || {};
	if (errors && !_.isEmpty(errors)) {
		let txnId = req.headers['txnId'];
		logger.error(`[${txnId}] Error in validation date fields :: `, errors);
		return res.status(400).json({ message: 'Error in validation date fields', errors });
	}
	logger.trace(`[${txnId}] Payload after date field validation`, payload);

	let status;
	let wfId;
	let isNewDoc = false;
	let id = req.params.id;
	let useFilter = req.params.useFilter;
	let filter = { _id: id };

	if (req.query.filter && (useFilter == 'true' || useFilter == true)) {
		filter = JSON.parse(decodeURIComponent(req.query.filter));
		let tempFilter;
		if (!serviceData.schemaFree) {
			tempFilter = await specialFields.patchRelationInFilter(
				req,
				filter,
				errors
			);
		}

		if (Array.isArray(tempFilter) && tempFilter.length > 0) {
			filter = tempFilter[0];
		} else if (tempFilter) {
			filter = tempFilter;
		}

		if (!serviceData.schemaFree) {
			filter = modifySecureFieldsFilter(
				filter,
				specialFields.secureFields,
				false
			);
		}
	}
	logger.debug(`[${txnId}] Update request received for record ${id}`);
	logger.debug(`[${txnId}] Schema Free ? ${serviceData.schemaFree}`);

	if (!serviceData.schemaFree) {
		const dynamicFilter = await specialFields.getDynamicFilter(req);
		if (!_.isEmpty(dynamicFilter)) {
			const tester = sift(dynamicFilter);
			if (!tester(payload)) {
				logger.warn(`[${txnId}] Dynamic Filter, Forbidden Payload`);
				return res.status(400).json({ message: 'You don\'t have access for this operation.' });
			}
		}
	}

	if (req.query.txn == true) {
		logger.debug(`[${txnId}] Update request is a part of a transaction ${id}`);
		return transactionUtils.transferToTransaction(req, res);
	}

	try {
		addExpireAt(req);
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}
	if (!specialFields.hasPermissionForPUT(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		logger.error(`[${txnId}] User does not have permission to update records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
		return res.status(403).json({
			message: 'You don\'t have permission to update records',
		});
	}

	const workflowModel = mongoose.model('workflow');
	try {
		let doc = await model.findOne(filter);

		logger.trace(`[${txnId}] Document from DB - ${JSON.stringify(doc)}`);
		logger.trace(`[${txnId}] Payload from request - ${JSON.stringify(payload)}`);
		logger.debug(`[${txnId}] Upsert allowed ? ${upsert}`);

		const hasSkipReview = workflowUtils.hasAdminAccess(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []));
		logger.debug(`[${txnId}] has Skip Review permissions? ${hasSkipReview}`);
		logger.debug(`[${txnId}] Is workflow enabled ? ${workflowUtils.isWorkflowEnabled()}`);

		if (!doc && !upsert) {
			return res.status(404).json({
				message: 'Document Not Found',
			});
		}

		if (!doc && upsert) {
			logger.info(`[${txnId}] Document not found, creating a new doc : ${id}`);
			isNewDoc = true;
			payload._id = req.params.id;
			delete payload._metadata;
			delete payload.__v;
			doc = new model(payload);

			if (!serviceData.schemaFree && serviceData.stateModel && serviceData.stateModel.enabled && !hasSkipReview) {
				if (!_.get(payload, serviceData.stateModel.attribute)) {
					_.set(payload, serviceData.stateModel.attribute, serviceData.stateModel.initialStates[0]);
				}
				if (!serviceData.stateModel.initialStates.includes(_.get(payload, serviceData.stateModel.attribute))) {
					throw new Error('Record is not in initial state.');
				}
			}
		}

		if (!serviceData.schemaFree && serviceData.stateModel && serviceData.stateModel.enabled && !isNewDoc && !hasSkipReview
			&& _.get(payload, serviceData.stateModel.attribute)
			&& !serviceData.stateModel.states[_.get(doc, serviceData.stateModel.attribute)].includes(_.get(payload, serviceData.stateModel.attribute))
			&& _.get(doc, serviceData.stateModel.attribute) !== _.get(payload, serviceData.stateModel.attribute)) {
			throw new Error('State transition is not allowed');
		}

		if (doc._metadata && doc._metadata.workflow) {
			return res.status(400).json({
				message: 'This Document is Locked because of a pending Workflow',
			});
		}

		if (!isNewDoc) {
			delete payload._id;
			doc._oldDoc = doc.toObject();
		}
		doc._req = req;

		if (
			(workflowUtils.isWorkflowEnabled() && !hasSkipReview) ||
			req.query.draft
		) {
			let wfItemStatus = 'Pending';
			if (req.query.draft) {
				wfItemStatus = 'Draft';
			}
			const wfItem = workflowUtils.getWorkflowItem(
				req,
				isNewDoc ? 'POST' : 'PUT',
				doc._id,
				wfItemStatus,
				payload,
				isNewDoc ? null : doc._oldDoc
			);
			const document = new model(payload);
			await document.validate();
			const wfDoc = new workflowModel(wfItem);
			wfDoc._req = req;
			status = await wfDoc.save();
			wfId = status._id;
			status = await model.findByIdAndUpdate(doc._id, {
				'_metadata.workflow': status._id,
			});
			return res.status(200).json({
				_workflow: wfId,
				message: 'Workflow has been created',
			});
		} else {
			logger.debug(`[${txnId}] Merging and saving doc`);
			if (!serviceData.schemaFree) {
				_.mergeWith(doc, payload, mergeCustomizer);
			} else {
				Object.keys(doc.toObject()).forEach(key => {
					if (key !== '__v' && key !== '_id' && key !== '_metadata' && key !== '_workflow') {
						if (payload[key] === undefined) {
							doc.set(key, undefined);
						}
					}
				});
				Object.keys(payload).forEach(key => {
					if (doc.get(key) !== payload[key])
						doc.set(key, payload[key]);
				});

			}
			status = await doc.save();
			logger.debug(`[${txnId}] Update status - ${status}`);
			delete status._metadata?._id;
			delete status._metadata?.version?._id;
			return res.status(200).json(status);
		}
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.delete('/:id', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	let id = req.params.id;
	logger.debug(`[${txnId}] Delete request received for record ${id}`);

	if (req.query.txn == true) {
		logger.debug(`[${txnId}] Delete request is a part of a transaction ${id}`);
		return transactionUtils.transferToTransaction(req, res);
	}
	if (!specialFields.hasPermissionForDELETE(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		logger.error(`[${txnId}] User does not have permission to update/delete records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
		return res.status(403).json({
			message: 'You don\'t have permission to update records',
		});
	}

	const workflowModel = mongoose.model('workflow');
	try {
		let doc = await model.findById(id);

		if (!serviceData.schemaFree) {
			const dynamicFilter = await specialFields.getDynamicFilter(req);
			if (!_.isEmpty(dynamicFilter)) {
				const tester = sift(dynamicFilter);
				if (!tester(doc.toObject())) {
					logger.warn(`[${txnId}] Dynamic Filter, Forbidden Payload`);
					return res.status(400).json({ message: 'You don\'t have access for this operation.' });
				}
			}
		}
		logger.trace(`[${txnId}] Document from DB - ${JSON.stringify(doc)}`);

		let status;
		if (!doc) {
			return res.status(404).json({
				message: `Record With ID ${id} Not Found`,
			});
		}
		if (doc._metadata.workflow) {
			return res.status(400).json({
				message: 'This Document is Locked because of a pending Workflow',
			});
		}

		doc._req = req;
		doc._oldDoc = doc.toObject();
		const hasSkipReview = workflowUtils.hasAdminAccess(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []));

		logger.debug(`[${txnId}] has Skip Review? ${hasSkipReview}`);
		logger.debug(`[${txnId}] Workflow Enabled? ${workflowUtils.isWorkflowEnabled()}`);

		let wfId;
		if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
			logger.debug(`[${txnId}] Creating workflow.`);

			const wfItem = workflowUtils.getWorkflowItem(
				req,
				'DELETE',
				doc._id,
				'Pending',
				null,
				doc.toObject()
			);

			logger.trace(`[${txnId}] Workflow Item for record ${id} :: ${JSON.stringify(wfItem)}`);

			const wfDoc = new workflowModel(wfItem);
			wfDoc._req = req;
			status = await wfDoc.save();
			wfId = status._id;
			doc._metadata.workflow = status._id;
			status = await model.findByIdAndUpdate(doc._id, {
				'_metadata.workflow': status._id,
			});
			logger.trace(`[${txnId}] Update status ${status}`);
		} else {
			logger.debug(`[${txnId}] Is permanent delete enabled? ${config.permanentDelete}`);

			if (!config.permanentDelete) {
				let softDeletedDoc = new softDeletedModel(doc);
				softDeletedDoc.isNew = true;
				await softDeletedDoc.save();
			}
			status = await doc.remove();
		}
		logger.trace(`[${txnId}] Deleted documnet ${id} :: ${status}`);
		res.status(200).json({
			_workflow: wfId,
			message: 'Document Deleted',
		});
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.put('/:id/math', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	try {
		if (!specialFields.hasPermissionForPUT(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			return res.status(403).json({
				message: 'You don\'t have permission to update records',
			});
		}
		const hasSkipReview = workflowUtils.hasAdminAccess(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []));
		if (workflowUtils.isWorkflowEnabled() && !hasSkipReview) {
			return res.status(403).json({ message: 'User Must have Admin Permission to use Math API' });
		}
		mathQueue.push({ req, res });
	} catch (e) {
		handleError(res, e, txnId);
	}
});

// WHAT is THIS?
router.post('/hook', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	try {
		const url = req.query.url;
		const payload = req.body;
		if (!url) {
			return res.status(400).json({
				message: 'URL is Mandatory',
			});
		}
		try {
			const httpRes = await hooksUtils.invokeHook({ txnId, hook: { url }, payload });
			res.status(200).json(httpRes);
		} catch (e) {
			res.status(400).json({
				message: e.message,
			});
		}
	} catch (e) {
		handleError(res, e, txnId);
	}
});

function addAuthHeader(paths, jwt) {
	Object.keys(paths).forEach((path) => {
		Object.keys(paths[path]).forEach((method) => {
			if (
				typeof paths[path][method] == 'object' &&
				paths[path][method]['parameters']
			) {
				let authObj = paths[path][method]['parameters'].find(
					(obj) => obj.name == 'authorization'
				);
				if (authObj) authObj.default = jwt;
			}
		});
	});
}

/******************************* OLD Math API Logic *************************/

// function processMathQueue(obj, cb) {
// 	obj.req.simulateFlag = false;
// 	let webHookData = null;
// 	let id = obj.req.params.id;
// 	let resData = null;
// 	obj.req.query.source = 'presave';
// 	obj.req.simulate = false;
// 	return doRoundMathAPI(obj.req, obj.res)
// 		.then(resBody => {
// 			resData = resBody;
// 			obj.res.json(resBody);
// 			cb();
// 		})
// 		.then(() => {
// 			return getWebHookAndAuditData(obj.req, id, false);
// 		})
// 		.then(_d => {
// 			webHookData = _d;
// 			pushWebHookAndAuditData(webHookData, resData);
// 		})
// 		.catch(err => {
// 			logger.error(err.message);
// 			cb();
// 			if (err.message == 'CUSTOM_READ_CONFLICT' || (err.errmsg === 'WriteConflict' && err.errorLabels && err.errorLabels.indexOf('TransientTransactionError') > -1)) {
// 				logger.error('=================');
// 				obj.req.simulateFlag = true;
// 				if (!obj.res.headersSent) {
// 					mathQueue.push({ req: obj.req, res: obj.res });
// 				}
// 			} else {
// 				let status = err.name == 'ValidationError' ? 400 : 500;
// 				obj.res.status(status).json({ message: err.message });
// 			}
// 		});
// }

// function getWebHookAndAuditData(req, id, isNew) {
// 	let data = {};
// 	data.serviceId = id;
// 	data.operation = req.method;
// 	data.user = req.headers[global.userHeader];
// 	data.txnId = req.headers[global.txnIdHeader];
// 	data.timeStamp = new Date();
// 	data.data = {};
// 	if (id) {
// 		let promise = isNew ? Promise.resolve(null) : model.findOne({ _id: id });
// 		return promise
// 			.then(doc => {
// 				if (doc) {
// 					data.operation = data.operation == 'DELETE' ? data.operation : 'PUT';
// 					data.data.old = JSON.stringify(doc.toJSON());
// 				}
// 				else {
// 					data.data.old = null;
// 				}
// 				return data;
// 			});
// 	}
// 	return Promise.resolve(data);
// }

// function pushWebHookAndAuditData(webHookData, newData) {
// 	webHookData._id = newData._id;
// 	webHookData.data.new = JSON.stringify(newData);
// 	queue.sendToQueue(webHookData);
// 	let auditData = {};
// 	auditData.versionValue = '-1';
// 	auditData.user = webHookData.user;
// 	auditData.txnId = webHookData.txnId;
// 	auditData.timeStamp = webHookData.timeStamp;
// 	auditData.data = {};
// 	auditData.data.old = {};
// 	auditData.data.new = {};
// 	auditData._metadata = {};
// 	auditData.colName = 'Adam.complex.audit';
// 	auditData._metadata.lastUpdated = new Date();
// 	auditData._metadata.createdAt = new Date();
// 	auditData._metadata.deleted = false;
// 	auditData.data._id = JSON.parse(webHookData.data.new)._id;
// 	auditData.data._version = JSON.parse(webHookData.data.new)._metadata.version.document;
// 	getDiff(JSON.parse(webHookData.data.old), JSON.parse(webHookData.data.new), auditData.data.old, auditData.data.new);
// 	let oldLastUpdated = auditData.data.old && auditData.data.old._metadata ? auditData.data.old._metadata.lastUpdated : null;
// 	let newLastUpdated = auditData.data.new && auditData.data.new._metadata ? auditData.data.new._metadata.lastUpdated : null;
// 	if (oldLastUpdated) delete auditData.data.old._metadata.lastUpdated;
// 	if (newLastUpdated) delete auditData.data.new._metadata.lastUpdated;

// 	if (!_.isEqual(auditData.data.old, auditData.data.new)) {
// 		if (oldLastUpdated) auditData.data.old._metadata.lastUpdated = oldLastUpdated;
// 		if (newLastUpdated) auditData.data.new._metadata.lastUpdated = newLastUpdated;
// 		if (auditData.versionValue != 0) {
// 			client.publish('auditQueue', JSON.stringify(auditData));
// 		}

// 	}
// }

// function getUpdatedDoc(doc, updateObj) {
// 	Object.keys(updateObj).forEach(_k => {
// 		let keyArr = _k.split('.');
// 		keyArr.reduce((acc, curr, i) => {
// 			if (i == keyArr.length - 1) {
// 				acc[curr] = updateObj[_k];
// 			}
// 			if (acc) {
// 				return acc[curr];
// 			}
// 		}, doc);
// 	});
// }

// function doRoundMathAPI(req) {
// 	let id = req.params.id;
// 	let body = req.body;
// 	let updateBody = { '$inc': { '_metadata.version.document': 1 } };
// 	let session = null;
// 	let resBody = null;
// 	let prevVersion = null;
// 	let promise = Promise.resolve();
// 	if (body['$inc']) {
// 		promise = Object.keys(body['$inc']).reduce((acc, curr) => {
// 			return acc.then(() => {
// 				let pField = specialFields.precisionFields.find(_p => _p.field == curr);
// 				if (pField && (pField.precision || pField.precision == 0)) {
// 					return roundMath(id, session, body['$inc'][curr], '$add', curr, pField.precision, prevVersion)
// 						.then(_val => {
// 							logger.debug({ _val });
// 							if (_val) {
// 								prevVersion = _val.prevVersion;
// 								if (!updateBody['$set']) {
// 									updateBody['$set'] = {};
// 								}
// 								updateBody['$set'][curr] = _val.val;
// 							}
// 							return Promise.resolve();
// 						});
// 				} else {
// 					if (!updateBody['$inc']) {
// 						updateBody['$inc'] = {};
// 					}
// 					updateBody['$inc'][curr] = body['$inc'][curr];
// 					return Promise.resolve();
// 				}
// 			});
// 		}, promise);
// 	}
// 	if (body['$mul']) {
// 		promise = Object.keys(body['$mul']).reduce((acc, curr) => {
// 			return acc.then(() => {
// 				let pField = specialFields.precisionFields.find(_p => _p.field == curr);
// 				if (pField && (pField.precision || pField.precision == 0)) {
// 					return roundMath(id, session, body['$mul'][curr], '$multiply', curr, pField.precision, prevVersion)
// 						.then(_val => {
// 							if (_val) {
// 								prevVersion = _val.prevVersion;
// 								if (!updateBody['$set']) {
// 									updateBody['$set'] = {};
// 								}
// 								updateBody['$set'][curr] = _val.val;
// 							}
// 							return Promise.resolve();
// 						});
// 				} else {
// 					if (!updateBody['$mul']) {
// 						updateBody['$mul'] = {};
// 					}
// 					updateBody['$mul'][curr] = body['$mul'][curr];
// 					return Promise.resolve();
// 				}
// 			});
// 		}, promise);
// 	}
// 	const opts = { new: true };
// 	let generateId = false;
// 	let globalDoc = null;
// 	return promise.then(() => {
// 		if (updateBody['$set']) {
// 			return model.findOne({ _id: id })
// 				.then((_doc) => {
// 					getUpdatedDoc(_doc, updateBody['$set']);
// 					globalDoc = _doc;
// 					return _doc.validate();
// 				})
// 				.then(() => {
// 					if (!req.simulateFlag)
// 						return workflowUtils.simulate(req, globalDoc, { generateId, operation: 'PUT' });
// 					return globalDoc;
// 				})
// 				.then((_d) => {
// 					logger.debug({ _id: id, '_metadata.version.document': prevVersion });
// 					return model.findOneAndUpdate({ _id: id, '_metadata.version.document': prevVersion }, _d, opts);
// 				});
// 		}
// 	}).then(_newBody => {
// 		resBody = _newBody;
// 		if (!_newBody) {
// 			logger.debug({ _newBody });
// 			throw new Error('CUSTOM_READ_CONFLICT');
// 		}
// 		logger.debug(JSON.stringify({ resBody }));
// 	}).then(() => {
// 		return resBody;
// 	});
// }

// function roundMath(id, session, value, operation, field, precision, prevVersion) {
// 	let precisionFactor = Math.pow(10, precision);
// 	return model.aggregate([
// 		{ $match: { _id: id } },
// 		{
// 			$project: {
// 				_id: 0,
// 				docVersion: '$_metadata.version.document',
// 				y: {
// 					$divide: [
// 						{
// 							$subtract: [
// 								{
// 									$add: [{ $multiply: [{ [operation]: [`$${field}`, value] }, precisionFactor] }, 0.5]
// 								},
// 								{
// 									$abs: { $mod: [{ $add: [{ $multiply: [{ [operation]: [`$${field}`, value] }, precisionFactor] }, 0.5] }, 1] }
// 								}
// 							]
// 						}, precisionFactor]
// 				}
// 			}
// 		}
// 	]).then(_a => {
// 		logger.debug(JSON.stringify({ _a, prevVersion }));
// 		if (!_a || !_a[0]) {
// 			throw new Error('Document not found');
// 		}
// 		if (_a && _a[0] && (prevVersion || prevVersion == 0) && prevVersion != _a[0]['docVersion']) {
// 			throw new Error('CUSTOM_READ_CONFLICT');
// 		}
// 		if (_a && _a[0]) {
// 			prevVersion = _a[0]['docVersion'];
// 		}
// 		logger.debug('new ' + JSON.stringify({ _a, prevVersion }));
// 		return _a && _a[0] && (_a[0].y || _a[0].y === 0) ? { val: parseFloat(_a[0].y.toFixed(precision)), prevVersion } : null;
// 	});
// }

/******************************* NEW Math API Logic *************************/

async function processMathQueue(obj, callback) {
	const req = obj.req;
	const res = obj.res;
	const oldNewData = {};
	try {
		// req.simulateFlag = false;
		// req.query.source = 'presave';
		// req.simulate = false;
		const updatedBody = await doRoundMathAPI(req, res, oldNewData);
		res.json(updatedBody);
		pushWebHookAndAuditData(req, oldNewData);
		if (callback) {
			callback();
		}
	} catch (err) {
		logger.error(err.message);
		if (callback) {
			callback();
		}
		if (
			err.message == 'CUSTOM_READ_CONFLICT' ||
			(err.errmsg === 'WriteConflict' &&
				err.errorLabels &&
				err.errorLabels.indexOf('TransientTransactionError') > -1)
		) {
			logger.error('=================');
			req.simulateFlag = true;
			if (!res.headersSent) {
				mathQueue.push({ req: req, res: res });
			}
		} else {
			let status = err.name == 'ValidationError' ? 400 : 500;
			res.status(status).json({ message: err.message });
		}
	}
}

function pushWebHookAndAuditData(req, webHookData) {
	webHookData.user = req.headers[global.userHeader];
	webHookData.txnId = req.headers[global.txnIdHeader] || req.headers['txnid'] || req.headers['TxnId'];
	hooksUtils.prepPostHooks(JSON.parse(JSON.stringify(webHookData)));
	if (!config.disableAudits) {
		let auditData = {};
		auditData.versionValue = '-1';
		auditData.user = webHookData.user;
		auditData.txnId = webHookData.txnId;
		auditData.timeStamp = new Date();
		auditData.data = {};
		auditData.data.old = JSON.parse(JSON.stringify(webHookData.old));
		auditData.data.new = JSON.parse(JSON.stringify(webHookData.new));
		auditData._metadata = {};
		auditData.colName = `${config.app}.${config.serviceCollection}.audit`;
		auditData._metadata.lastUpdated = new Date();
		auditData._metadata.createdAt = new Date();
		auditData._metadata.deleted = false;
		auditData.data._id = webHookData.new._id;
		auditData.data._version = webHookData.new._metadata.version.document;
		getDiff(
			webHookData.old,
			webHookData.new,
			auditData.data.old,
			auditData.data.new
		);
		let oldLastUpdated = auditData.data.old && auditData.data.old._metadata ? auditData.data.old._metadata.lastUpdated : null;
		let newLastUpdated = auditData.data.new && auditData.data.new._metadata ? auditData.data.new._metadata.lastUpdated : null;
		if (oldLastUpdated) delete auditData.data.old._metadata.lastUpdated;
		if (newLastUpdated) delete auditData.data.new._metadata.lastUpdated;
		if (!_.isEqual(auditData.data.old, auditData.data.new)) {
			if (oldLastUpdated)
				auditData.data.old._metadata.lastUpdated = oldLastUpdated;
			if (newLastUpdated)
				auditData.data.new._metadata.lastUpdated = newLastUpdated;
			// client.publish('auditQueue', JSON.stringify(auditData))
			hooksUtils.insertAuditLog(webHookData.txnId, auditData);
		}
	}
}

async function doRoundMathAPI(req, res, oldNewData) {
	try {
		const id = req.params.id;
		const body = req.body;
		let prevVersion;

		// Fetching Existing Record to store document version.
		const doc = await model.findOne({ _id: id });
		oldNewData.old = doc.toObject();
		oldNewData._id = id;
		prevVersion = doc.toObject()._metadata.version.document;

		// Grouping math operations for each field.
		const fields = {};
		body.forEach((item) => {
			const key = Object.keys(item)[0];
			const field = Object.keys(item[key])[0];
			if (!fields[field]) {
				fields[field] = [];
			}
			fields[field].push(item);
		});

		// Creating a $project query of each field.
		const project = {};
		Object.keys(fields).forEach((key) => {
			const query = fields[key].reduce((prev, curr) => {
				const temp = {};
				const operation = Object.keys(curr)[0];
				const projectOperation = operation === '$inc' ? '$add' : '$multiply';
				temp[projectOperation] = [
					Object.values(curr[operation])[0],
					prev ? prev : '$' + Object.keys(curr[operation])[0],
				];
				return temp;
			}, null);
			project[key] = query;
		});

		const docs = await model.aggregate([
			{ $match: { _id: id, '_metadata.version.document': prevVersion } },
			{
				$project: project,
			},
		]);
		if (!docs || !docs[0]) {
			throw new Error('CUSTOM_READ_CONFLICT');
		}
		const updateData = flatten(docs[0]);
		delete updateData._id;
		specialFields.precisionFields.forEach((item) => {
			if (updateData[item.field]) {
				// let precisionFactor = Math.pow(10, precision);
				updateData[item.field] = parseFloat(
					updateData[item.field].toFixed(item.precision)
				);
			}
		});

		const status = await model.findOneAndUpdate(
			{ _id: id, '_metadata.version.document': prevVersion },
			{ $set: updateData, $inc: { '_metadata.version.document': 1 } },
			{ new: true }
		);
		oldNewData.new = status.toObject();
		return status;
	} catch (err) {
		logger.error(err);
		throw err;
	}
}

function handleError(res, err, txnId) {
	let message;
	logger.error(`[${txnId}] : Some Error Occured :: `, err);
	if (err.response) {
		if (err.response.body) {
			if (typeof err.response.body === 'string') {
				try {
					err.response.body = JSON.parse(err.response.body);
				} catch (e) {
					logger.error(`[${txnId}] : Error While Parsing Error Body`);
				}
			}
			if (err.response.body.message) {
				message = err.response.body.message;
			} else {
				message = err.response.body;
			}
		} else {
			message = `[${txnId}] : ${err.message}`;
		}
	} else if (typeof err === 'string') {
		message = err;
	} else {
		message = err.message;
	}
	if (!res.headersSent) {
		res.status(500).json({ message });
	}
	// throw new Error(message);
}


function addExpireAt(req) {
	let expireAt = null;
	if (req.query.expireAt) {
		expireAt = req.query.expireAt;
		if (!isNaN(expireAt)) {
			expireAt = parseInt(req.query.expireAt);
		}
		expireAt = new Date(expireAt);
	} else if (req.query.expireAfter) {
		let expireAfter = req.query.expireAfter;
		let addTime = 0;
		let time = {
			s: 1000,
			m: 60000,
			h: 3600000
		};
		let timeUnit = expireAfter.charAt(expireAfter.length - 1);
		if (!isNaN(timeUnit)) addTime = parseInt(expireAfter) * 1000;
		else {
			let timeVal = expireAfter.substr(0, expireAfter.length - 1);
			if (time[timeUnit] && !isNaN(timeVal)) {
				addTime = parseInt(timeVal) * time[timeUnit];
			} else {
				throw new Error('expireAfter value invalid');
			}
		}
		expireAt = new Date().getTime() + addTime;
		expireAt = new Date(expireAt);
	}
	if (expireAt) {
		if (isNaN(expireAt.getTime())) {
			throw new Error('expire value invalid');
		}
		if (Array.isArray(req.body)) {
			let expString = expireAt.toISOString();
			req.body = req.body.map(_d => {
				_d['_expireAt'] = expString;
			});
		} else {
			req.body['_expireAt'] = expireAt.toISOString();
		}
	}
}

module.exports = router;
