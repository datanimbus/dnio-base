const router = require('express').Router();
const mongoose = require('mongoose');
const log4js = require('log4js');
const swaggerParser = require('swagger-parser');
const _ = require('lodash');
const sift = require('sift');

const config = require('../../config');
const specialFields = require('../utils/special-fields.utils');
const hooksUtils = require('../utils/hooks.utils');
const crudderUtils = require('../utils/crudder.utils');
const workflowUtils = require('../utils/workflow.utils');
const transactionUtils = require('../utils/transaction.utils');
const {
	mergeCustomizer,
	modifySecureFieldsFilter,
} = require('./../utils/common.utils');
const serviceData = require('../../service.json');

const logger = log4js.getLogger(global.loggerName);

const model = mongoose.model(config.serviceId);
let softDeletedModel;
if (!config.permanentDelete)
	softDeletedModel = mongoose.model(config.serviceId + '.deleted');

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
				filter = JSON.parse(req.query.filter);
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
			logger.trace(`[${txnId}] Filter ${req.query.filter}`);
			logger.trace(`[${txnId}] Sort ${req.query.sort}`);
			logger.trace(`[${txnId}] Select ${req.query.select}`);
			logger.trace(`[${txnId}] Skip ${req.query.skip}`);
			logger.trace(`[${txnId}] Limit ${req.query.limit}`);

			if (req.query.filter) {
				filter = JSON.parse(req.query.filter);
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

		let docs = await model
			.find(filter)
			.select(select)
			.sort(sort)
			.skip(skip)
			.limit(count)
			.lean();

		if (!serviceData.schemaFree) {
			docs.forEach(doc => specialFields.filterByPermission(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []), doc));
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
				let promises = docs.map((e) =>
					specialFields.decryptSecureFields(req, e, null)
				);
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
	try {
		let id = req.params.id;
		logger.debug(`[${txnId}] Get request received for ${id}`);

		if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			logger.error(`[${txnId}] User does not have permission to fetch records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
			return res.status(403).json({
				message: 'You don\'t have permission to fetch a record',
			});
		}

		let doc = await model.findById(id).lean();
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
		res.status(200).json(doc);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.post('/', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	let id = req.params.id;
	let payload = req.body;
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

	if (!specialFields.hasPermissionForPOST(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		logger.error(`[${txnId}] User does not have permission to create records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
		return res.status(403).json({
			message: 'You don\'t have permission to create records',
		});
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

					logger.debug('Creating model');
					const doc = new model(data);
					logger.debug('Creating model - DONE');
					doc._req = req;
					try {
						return (await doc.save()).toObject();
					} catch (e) {
						logger.error(`[${txnId}] : Error while inserting record :: `, e);
						return { message: e.message };
					}
				});
				promises = await Promise.all(promises);
			} else {
				if (!serviceData.schemaFree && serviceData.stateModel && serviceData.stateModel.enabled && !hasSkipReview) {
					if (!_.get(payload, serviceData.stateModel.attribute)) {
						_.set(payload, serviceData.stateModel.attribute, serviceData.stateModel.initialStates[0]);
					}

					if (!serviceData.stateModel.initialStates.includes(_.get(payload, serviceData.stateModel.attribute))) {
						throw new Error('Record is not in initial state.');
					}
				}

				const doc = new model(payload);
				doc._req = req;
				promises = (await doc.save()).toObject();
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
	let status;
	let wfId;
	let isNewDoc = false;
	let id = req.params.id;
	let useFilter = req.params.useFilter;
	let filter = { _id: id };
	let errors = {};
	if (req.query.filter && (useFilter == 'true' || useFilter == true)) {
		filter = JSON.parse(req.query.filter);
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
	res.status(500).json({ message });
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