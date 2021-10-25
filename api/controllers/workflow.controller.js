'use strict';
const router = require('express').Router();
const mongoose = require('mongoose');
const _ = require('lodash');

const config = require('../../config');
const workflowUtils = require('../utils/workflow.utils');
const crudderUtils = require('../utils/crudder.utils');
const specialFields = require('../utils/special-fields.utils');

const logger = global.logger;
const authorDB = global.authorDB;
const serviceModel = mongoose.model(config.serviceId);
let softDeletedModel;
if (!config.permanentDelete) softDeletedModel = mongoose.model(config.serviceId + '.deleted');
const { modifySecureFieldsFilter, mergeCustomizer } = require('./../utils/common.utils');
// const workflowModel = authorDB.model('workflow');
const workflowModel = mongoose.model('workflow');

/**
 * @deprecated
 */
router.get('/count', async (req, res) => {
	try {
		let filter = {};
		try {
			if (req.query.filter) {
				filter = JSON.parse(req.query.filter);
				filter = crudderUtils.parseFilter(filter);
				filter = modifySecureFieldsFilter(filter, specialFields.secureFields, false, true);
			}
		} catch (err) {
			logger.error(err);
			return res.status(400).json({
				message: err
			});
		}
		const count = await workflowModel.countDocuments(filter);
		res.status(200).json(count);
	} catch (err) {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	}
});

router.get('/users', async (req, res) => {
	try {
		let txnId = req.get(global.txnIdHeader);
		let filter = req.query.filter ? req.query.filter : {};
		filter = typeof filter === 'string' ? JSON.parse(filter) : filter;
		let wfData = await workflowModel.aggregate([
			{ $match: filter },
			{
				$group: {
					_id: null,
					requestedBy: {
						$addToSet: '$requestedBy'
					},
					respondedBy: {
						$addToSet: '$respondedBy'
					}
				}
			}
		]);

		wfData = wfData[0];
		logger.debug(`${txnId} : WF users wfData :: `, wfData);
		if (wfData) {
			delete wfData._id;
			let users = _.uniq(wfData.requestedBy.concat(wfData.respondedBy));
			let usersCollection = authorDB.collection('userMgmt.users');
			let usersData = await usersCollection.find({ _id: { $in: users } }).project({ '_id': 1, 'basicDetails.name': 1 });
			let userMap = {};
			usersData.forEach(user => userMap[user._id] = user.basicDetails ? user.basicDetails.name : '');
			logger.debug(`${txnId} : users map :: `, userMap);
			wfData.requestedBy = getUsersNameFromMap(userMap, wfData.requestedBy);
			wfData.respondedBy = getUsersNameFromMap(userMap, wfData.respondedBy);
			return res.json(wfData);
		} else {
			return res.json({});
		}
	} catch (err) {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	}
});

router.get('/serviceList', async (req, res) => {
	try {
		const resObj = {};
		resObj[config.serviceId] = 0;
		let filter = req.query.filter;
		if (filter) filter = JSON.parse(filter);
		filter = crudderUtils.parseFilter(filter);
		filter.serviceId = config.serviceId;
		const count = await workflowModel.countDocuments(filter);
		resObj[config.serviceId] = count;
		res.status(200).json(resObj);
	} catch (err) {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	}
});

router.get('/', async (req, res) => {
	try {
		let filter = {};
		try {
			if (req.query.filter) {
				filter = JSON.parse(req.query.filter);
				filter = crudderUtils.parseFilter(filter);
				filter = modifySecureFieldsFilter(filter, specialFields.secureFields, false, true);
			}
		} catch (err) {
			logger.error(err);
			return res.status(400).json({
				message: err
			});
		}
		if (req.query.countOnly) {
			const count = await workflowModel.countDocuments(filter);
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
		let docs = await workflowModel.find(filter).select(select).sort(sort).skip(skip).limit(count).lean();

		docs = await decryptAndExpandWFItems(docs, req);
		res.status(200).json(docs);
	} catch (err) {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	}
});

router.put('/action', async (req, res) => {
	try {
		if (!req.body.action) {
			return res.status(400).json({ message: 'Action is required.' });
		} else if (req.body.action == 'Discard') {
			return discard(req, res);
		} else if (req.body.action == 'Submit') {
			return submit(req, res);
		} else if (req.body.action == 'Rework') {
			return rework(req, res);
		} else if (req.body.action == 'Approve') {
			return approve(req, res);
		} else if (req.body.action == 'Reject') {
			return reject(req, res);
		} else {
			return res.status(400).json({ message: 'Action is Invalid.' });
		}
	} catch (err) {
		logger.error(err);
		if (err.source) {
			res.status(400).json(err);
		} else {
			res.status(400).json({
				message: err.message
			});
		}
	}
});

router.get('/:id', async (req, res) => {
	try {
		let doc = await workflowModel.findById(req.params.id).lean();
		if (!doc) {
			return res.status(404).json({
				message: 'Workflow Not Found'
			});
		}
		doc = await decryptAndExpandWFItems(doc, req);
		res.status(200).json(doc);
	} catch (err) {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	}
});

// router.put('/:id', async (req, res) => {
// 	try {
// 		const id = req.params.id;
// 		const payload = req.body;
// 		const remarks = payload.remarks;
// 		const attachments = payload.attachments;
// 		const audit = payload.audit;
// 		const doc = await workflowModel.findOne({ $and: [{ _id: id }, { status: { $in: ['Pending'] } }] });
// 		if (!doc) {
// 			return res.status(400).json({ message: 'Workflow to be editted not found' });
// 		}
// 		if (audit && Array.isArray(audit) && audit.length > 0) {
// 			doc.audit = audit;
// 		}
// 		if (attachments && Array.isArray(attachments) && attachments.length > 0) {
// 			doc.attachments = attachments;
// 		}
// 		if (remarks) {
// 			doc.remarks = remarks;
// 		}
// 		doc._req = req;
// 		doc._isEncrypted = true;
// 		const savedData = await doc.save();
// 		logger.trace('Workflow Doc Updated', JSON.stringify({ savedData }));
// 		return res.status(200).json({ message: 'Edit Successful.' });
// 	} catch (err) {
// 		logger.error(err);
// 		if (err.source) {
// 			res.status(400).json(err);
// 		} else {
// 			res.status(400).json({
// 				message: err.message
// 			});
// 		}
// 	}
// });

router.put('/doc/:id', async (req, res) => {
	try {
		const id = req.params.id;
		const payload = req.body;
		const remarks = payload.remarks;
		const attachments = payload.attachments;
		const newData = payload.data;
		if (!specialFields.hasPermissionForPUT(req, req.user.appPermissions)) {
			return res.status(403).json({
				message: 'You don\'t have permission to update records',
			});
		}
		const doc = await workflowModel.findOne({ $and: [{ _id: id }, { status: { $nin: ['Approved', 'Rejected'] } }] });
		if (!doc) {
			return res.status(400).json({ message: 'Workflow to be editted not found' });
		}
		const data = await workflowUtils.simulate(req, newData, {
			source: `simulate-workflow ${doc.status} edit`,
			operation: doc.operation
		});
		const auditData = {
			by: 'user',
			action: 'Edit',
			id: req.user._id,
			remarks: remarks,
			attachments: attachments,
			timestamp: Date.now(),
			oldData: _.clone(doc.data.new),
			newData: _.mergeWith(_.clone(doc.data.new), _.clone(newData), mergeCustomizer)
		};
		if (doc.documentId) {
			data._id = doc.documentId;
		}
		doc.data.new = data;
		doc.audit.push(auditData);
		doc._req = req;
		const savedData = await doc.save();
		logger.debug(JSON.stringify({ savedData }));
		return res.status(200).json({ message: 'Edit Successful.' });
	} catch (err) {
		logger.error(err);
		if (err.source) {
			res.status(400).json(err);
		} else {
			res.status(400).json({
				message: err.message
			});
		}
	}
});

function getUsersNameFromMap(userMap, userIds) {
	return userIds.map(userId => {
		if (userMap[userId])
			return { _id: userId, name: userMap[userId] };
		else
			return { _id: userId };
	});
}

router.get('/group/:app', async (req, res) => {
	try {
		let app = req.params.app;
		let filter = req.query.filter;
		try {
			if (filter) {
				filter = JSON.parse(filter);
				filter = crudderUtils.parseFilter(filter);
			}
		} catch (err) {
			logger.error(err);
			filter = {};
		}
		Object.assign(filter, { 'app': app });
		filter['serviceId'] = config.serviceId;
		const data = await workflowModel.aggregate([
			{ '$match': filter },
			{ '$sort': { '_metadata.lastUpdated': 1 } },
			{
				'$group': {
					'_id': '$serviceId',
					'serviceId': { '$first': '$serviceId' }
				}
			},
			{
				'$lookup': {
					'from': 'workflow',
					'localField': '_id',
					'foreignField': 'serviceId',
					'as': 'wf'
				}
			},
			{
				'$project': {
					'wf.operation': 1,
					'wf.status': 1,
					'wf.requestedBy': 1,
					'wf._metadata.lastUpdated': 1
				}
			},
			{ '$sort': { '_metadata.lastUpdated': 1 } }
		]);
		res.json(data);
	} catch (err) {
		logger.error(err);
		res.status(400).json({
			message: err.message
		});
	}
});

async function discard(req, res) {
	try {
		const id = req.body.ids[0];
		const doc = await workflowModel.findOne({ $and: [{ _id: id }, { status: { $in: ['Draft', 'Rework'] } }] });
		if (!doc) {
			return res.status(400).json({ message: 'Discard Failed' });
		}
		doc.status = 'Discarded';
		const remarks = req.body.remarks;
		const attachments = req.body.attachments || [];
		const event = {
			by: 'user',
			action: 'Discard',
			id: req.user._id,
			remarks: remarks,
			attachments: attachments,
			timestamp: Date.now()
		};
		if (!doc.audit) {
			doc.audit = [];
		}
		doc.respondedBy = req.user._id;
		doc.audit.push(event);
		doc.markModified('audit');
		doc._req = req;
		doc._isEncrypted = true;
		const savedDoc = await doc.save();
		if (savedDoc.operation == 'PUT') {
			const status = await serviceModel.findOneAndUpdate({ _id: savedDoc.documentId }, { '_metadata.workflow': null }, { new: true });
			logger.debug('Unlocked Document', status);
		}
		return res.status(200).json({ message: 'Discard Successful' });
	} catch (err) {
		logger.error(err);
		return res.status(400).json({ message: err.message });
	}
}

async function submit(req, res) {
	try {
		const id = req.body.ids[0];
		const newData = req.body.data;
		const doc = await workflowModel.findOne({ $and: [{ _id: id }, { status: { $in: ['Draft', 'Rework'] } }] });
		if (!doc) {
			return res.status(400).json({ message: 'Submit Failed' });
		}
		doc.status = 'Pending';
		const remarks = req.body.remarks;
		const attachments = req.body.attachments || [];
		const event = {
			by: 'user',
			action: 'Submit',
			id: req.user._id,
			remarks: remarks,
			attachments: attachments,
			timestamp: Date.now()
		};
		let wfData = doc.data && doc.data.new ? doc.data.new : null;
		if (newData && wfData && !_.isEqual(JSON.parse(JSON.stringify(newData)), JSON.parse(JSON.stringify(wfData)))) {
			event.action = 'Save & Submit';
			doc.data.new = newData;
		}
		if (!doc.audit) {
			doc.audit = [];
		}
		doc.audit.push(event);
		doc.requestedBy = req.user._id;
		doc.markModified('audit');
		doc._req = req;
		doc._isEncrypted = true;
		await doc.save();
		return res.status(200).json({ message: 'Submission Successful' });
	} catch (err) {
		logger.error(err);
		return res.status(400).json({ message: err.message });
	}
}

async function rework(req, res) {
	try {
		const ids = req.body.ids;
		const docs = await workflowModel.find({ $and: [{ _id: ids }, { status: { $in: ['Pending'] } }, { requestedBy: { $ne: req.user._id } }] });
		if (!docs || docs.length == 0) {
			return res.status(400).json({ message: 'Rework Failed' });
		}
		const approvers = await workflowUtils.getApproversList();
		if (approvers.indexOf(req.user._id) == -1) {
			return res.status(403).json({ message: 'You Don\'t have Permission to any Action' });
		}
		const remarks = req.body.remarks;
		const attachments = req.body.attachments || [];
		const event = {
			by: 'user',
			action: 'SentForRework',
			id: req.user._id,
			remarks: remarks,
			attachments: attachments,
			timestamp: Date.now()
		};
		const promises = docs.map(doc => {
			doc.status = 'Rework';
			doc.respondedBy = req.user._id;
			if (!doc.audit) {
				doc.audit = [];
			}
			doc.audit.push(event);
			doc.markModified('audit');
			doc._req = req;
			doc._isEncrypted = true;
			return doc.save();
		});
		await Promise.all(promises);
		return res.status(200).json({ message: 'Sent For Changes.' });
	} catch (err) {
		logger.error(err);
		return res.status(400).json({ message: err.message });
	}
}

async function approve(req, res) {
	try {
		const ids = req.body.ids;
		const docs = await workflowModel.find({ _id: ids, status: { $nin: ['Approved', 'Rejected'] } });
		if (!docs || docs.length == 0) {
			return res.status(400).json({ message: 'No Documents To Approve' });
		}
		// const approvers = await specialFields.hasPermissionForGET  .getApproversList();
		// if (approvers.indexOf(req.user._id) == -1) {
		//     return res.status(403).json({ message: 'You Don\'t have Permission to any Action' });
		// }
		const remarks = req.body.remarks;
		const attachments = req.body.attachments || [];
		const results = [];
		const promises = docs.map(async (doc) => {
			if (!specialFields.hasWFPermissionFor[doc.checkerStep](req, req.user.appPermissions)) {
				return results.push({ status: 400, message: 'No Permission to approve WF record', id: doc._id });
			}
			let isFailed = false;
			const event = {
				by: 'user',
				id: req.user._id,
				remarks: remarks,
				attachments: attachments,
				timestamp: Date.now()
			};
			try {
				let serviceDoc;
				const tempReq = _.cloneDeep(req);
				tempReq.user._id = doc.requestedBy;
				const errors = await specialFields.validateRelation(req, doc.data.new, doc.data.old);
				if (errors) {
					logger.error('Relation Validation Failed:', errors);
					return results.push({ status: 400, message: 'Error While Validating Relation', id: doc._id, errors: errors });
				}
				const nextStep = specialFields.getNextWFStep(req, doc.checkerStep);
				if (!nextStep) {
					await specialFields.decryptSecureFields(req, doc.data.new, null);
					if (doc.operation == 'POST') {
						serviceDoc = new serviceModel(_.cloneDeep(doc.data.new));
						serviceDoc._req = tempReq;
						// serviceDoc._isFromWorkflow = true;
						serviceDoc = await serviceDoc.save();
						return results.push({ status: 200, message: 'WF item approved, Document was created', id: doc._id });
					} else if (doc.operation == 'PUT') {
						serviceDoc = await serviceModel.findById(doc.documentId);
						serviceDoc._req = tempReq;
						// serviceDoc._isFromWorkflow = true;
						serviceDoc._oldDoc = serviceDoc.toObject();
						delete doc.data.new._metadata;
						_.mergeWith(serviceDoc, doc.data.new, mergeCustomizer);
						serviceDoc._metadata.workflow = null;
						serviceDoc = await serviceDoc.save();
						return results.push({ status: 200, message: 'WF item approved, Document was updated', id: doc._id });
					} else if (doc.operation == 'DELETE') {
						serviceDoc = await serviceModel.findById(doc.documentId);
						serviceDoc._req = tempReq;
						// serviceDoc._isFromWorkflow = true;
						serviceDoc._oldDoc = serviceDoc.toObject();
						if (!config.permanentDelete) {
							let softDeletedDoc = new softDeletedModel(doc);
							softDeletedDoc.isNew = true;
							await softDeletedDoc.save();
						}
						serviceDoc = await serviceDoc.remove();
						return results.push({ status: 200, message: 'WF item approved, Document was removed', id: doc._id });
					}
					doc._status = 'Approved';
					doc.status = 'Approved';
					doc.respondedBy = req.user._id;
					event.action = 'Approved';
				} else {
					isFailed = true;
					doc._status = 'Approved';
					event.action = doc.checkerStep;
					const approvalsRequired = workflowUtils.getNoOfApprovals(req, doc.checkerStep);
					const approvalsDone = (doc.audit || []).filter(e => e.action === doc.checkerStep).length;
					if (approvalsRequired === approvalsDone + 1) {
						doc.checkerStep = nextStep;
						return results.push({ status: 200, message: `WF item moved to ${nextStep} step`, id: doc._id });
					}
					return results.push({ status: 200, message: `${approvalsDone + 1} Approval done for the ${doc.checkerStep} step`, id: doc._id });
				}
			} catch (err) {
				let error = err;
				try {
					if (typeof err === 'string') {
						error = JSON.parse(err);
					}
				} catch (parseErr) {
					logger.warn('Error was not a JSON String:', parseErr);
					error = err;
				}
				const message = typeof error === 'object' && error.message ? error.message : JSON.stringify(error);
				isFailed = true;
				event._noInsert = true;
				// event.by = 'Entity';
				// event.action = 'Process';
				// event.remarks = message;
				logger.error(error);
				results.push({ status: 500, message: message, id: doc._id, errors: error });
			} finally {
				if (!doc.audit) {
					doc.audit = [];
				}
				if (!event._noInsert) {
					doc.audit.push(event);
				}
				doc.markModified('audit');
				doc._req = req;
				if (!isFailed) {
					doc._isEncrypted = true;
				}
				// eslint-disable-next-line no-unsafe-finally
				return await doc.save();
			}
		});
		// let savedDocs = await Promise.all(promises);
		// savedDocs = await decryptAndExpandWFItems(savedDocs, req);
		// return res.status(200).json(savedDocs);
		await Promise.all(promises);
		if (results.some(e => e.status !== 200)) {
			return res.status(207).json({ results });
		}
		return res.status(200).json({ results });
	} catch (err) {
		logger.error(err);
		return res.status(400).json({ message: err.message });
	}
}

async function reject(req, res) {
	try {
		const ids = req.body.ids;
		const docs = await workflowModel.find({ $and: [{ _id: ids }, { status: { $in: ['Pending'] } }, { requestedBy: { $ne: req.user._id } }] });
		if (!docs || docs.length == 0) {
			return res.status(400).json({ message: 'No Documents To Reject' });
		}
		const approvers = await workflowUtils.getApproversList();
		if (approvers.indexOf(req.user._id) == -1) {
			return res.status(403).json({ message: 'You Don\'t have Permission to any Action' });
		}
		const remarks = req.body.remarks;
		const attachments = req.body.attachments || [];
		const event = {
			by: 'user',
			action: 'Rejected',
			id: req.user._id,
			remarks: remarks,
			attachments: attachments,
			timestamp: Date.now()
		};
		const promises = docs.map(async (doc) => {
			if (doc.operation == 'PUT' || doc.operation == 'DELETE') {
				const status = await serviceModel.findOneAndUpdate({ _id: doc.documentId }, { $unset: { '_metadata.workflow': 1 } }, { new: true });
				logger.debug('Unlocked Document', status);
			}
			doc.status = 'Rejected';
			doc.respondedBy = req.user._id;
			if (!doc.audit) {
				doc.audit = [];
			}
			doc.audit.push(event);
			doc.markModified('audit');
			doc._req = req;
			doc._isEncrypted = true;
			return await doc.save();
		});
		await Promise.all(promises);
		return res.status(200).json({ message: 'Documents Rejected' });
	} catch (err) {
		logger.error(err);
		return res.status(400).json({ message: err.message });
	}
}

async function decryptAndExpandWFItems(wfItems, req) {
	if (wfItems && Array.isArray(wfItems)) {
		// Decrypting secured fields
		if (specialFields.secureFields && specialFields.secureFields.length && specialFields.secureFields[0]) {
			let promises = [];
			wfItems.forEach(e => {
				if (e && e.data && e.data.old)
					promises.push(specialFields.decryptSecureFields(req, e.data.old, null));
				if (e && e.data && e.data.new)
					promises.push(specialFields.decryptSecureFields(req, e.data.new, null));
			});
			await Promise.all(promises);
			promises = null;
		}
		// Expanding Relations
		if (req.query.expand) {
			let promises = [];
			wfItems.forEach(e => {
				if (e && e.data && e.data.old)
					promises.push(specialFields.expandDocument(req, e.data.old, null));
				if (e && e.data && e.data.new)
					promises.push(specialFields.expandDocument(req, e.data.new, null));
			});
			await Promise.all(promises);
			promises = null;
		}
		return wfItems;
	} else {
		wfItems = await decryptAndExpandWFItems([wfItems], req);
		return wfItems[0];
	}
}


module.exports = router;