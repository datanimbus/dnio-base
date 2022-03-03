const router = require('express').Router();
const mongoose = require('mongoose');
const log4js = require('log4js');
const uuid = require('uuid/v1');

const config = require('../../config');
const threadUtils = require('../utils/thread.utils');
const httpClient = require('./../../http-client');
const specialFields = require('../utils/special-fields.utils');
const crudderUtils = require('../utils/crudder.utils');



const logger = log4js.getLogger(global.loggerName);
const model = mongoose.model('dedupe');


router.get('/:id', async (req, res) => {
	try {
		let doc = await model.findById(req.params.id).lean();
		if (!doc) {
			return res.status(404).json({
				message: `Dedupe Record With ID  ${req.params.id} Not Found.`
			});
		}
		const expandLevel = (req.header('expand-level') || 0) + 1;
		if (doc.docs && doc.docs.length && req.query.expand && expandLevel < 3) {
			let promises = doc.docs.map(e => specialFields.expandDocument(req, e, null, true));
			doc.docs = await Promise.all(promises);
			promises = null;
			if (doc.newDoc) {
				doc.newDoc = await specialFields.expandDocument(req, doc.newDoc);
			}
		}
		if (doc.docs && doc.docs.length && specialFields.secureFields && specialFields.secureFields.length && specialFields.secureFields[0]) {
			let promises = doc.docs.map(e => specialFields.decryptSecureFields(req, e, null));
			await Promise.all(promises);
			promises = null;
			if (doc.newDoc) {
				await specialFields.decryptSecureFields(req, doc.newDoc, null);
			}
		}
		res.status(200).json(doc);
	} catch (e) {
		let err = e;
		logger.error('Error in dedupe/:id :: ', err);
		if (typeof e === 'string') {
			err = new Error(e);
		}
		res.status(500).json({
			message: err.message
		});
	}
});

router.get('/', async (req, res) => {
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
				// filter = modifySecureFieldsFilter(filter, specialFields.secureFields, false);
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

		/**
		 * Having expand and decryption here could cause performance issues, 
		 its handled at /:id api though. Commenting here for now.
		 
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

		*/
		res.status(200).json(docs);
	} catch (e) {
		let err = e;
		if (typeof e === 'string') {
			err = new Error(e);
		}
		res.status(500).json({
			message: err.message
		});
	}
});

router.put('/review', async (req, res) => {
	let user = req.headers[global.userHeader];
	let txnId = req.headers[global.txnIdHeader];
	let dedupeFields = specialFields.dedupeFields;
	try {
		let dedupeId = uuid();
		logger.debug(`[${txnId}] :: Starting Dedupe process for ${user} on fields ${dedupeFields} with dedupeId ${dedupeId}`);
		// create search index on dedupe fields here
		res.status(202).json({ dedupeId, message: 'Process queued' });
		// To block write operaions
		informGW({
			serviceId: config.serviceId,
			status: 'PREVIEW'
		}, req.get('Authorization'));
		const result = await threadUtils.executeThread(txnId, 'dedupe-review', {
			dedupeId,
			dedupeFields,
			reqData: {
				headers: req.headers,
				rawHeaders: req.rawHeaders,
				user: req.user
			}
		});
		logger.info(`[${txnId}] : Dedupe ID ${dedupeId} result :: `, result);
		// To inform user he can start taking action on dedupe records
		informGW({
			serviceId: config.serviceId,
			status: 'READY_TO_PROCESS'
		}, req.get('Authorization'));
	} catch (e) {
		let err = e;
		logger.error(`[${txnId}] :: Error in starting dedupe review process `, err);
		if (typeof e === 'string') {
			err = new Error(e);
		}
		if (!res.headersSent) {
			res.status(500).json({
				message: err.message
			});
		}
	}
});


/**
 *  Payload in case of DISCARD action 
 * 		{
			"dedupeItems": [
				{"_id": "60928eaef50d689174857828"}, 
				{"_id": "60928eaef50d689174857829"}
			],
			"action": "DISCARD"
		}
		Where _id is mongo id of dedupe record
	Payload in case of MARK_ONE action 
		{
			"dedupeItems": [
				{
					"_id": "60928eaef50d689174857828",
					"newDoc": {
						"_id": "TES1002"
					}
				}, 
				{
					"_id": "60928eaef50d689174857829",
					"newDoc": {
						"_id": "TES1002"
					}
				}
			],
			"action": "MARK_ONE"
		}
		Where newDocId is the Id of record to choose from doc.docs array
	
	Payload in case of CREATE_NEW and UPDATE_ONE action 
		{
			"dedupeItems": [
				{
					"_id": "60928eaef50d689174857828",
					"newDoc": {
						// New doc prepared on UI
					}
				}, 
				{
					"_id": "60928eaef50d689174857829",
					"newDoc": {
						// Updated Doc prepared on UI
					}
				}
			],
			"action": "CREATE_NEW" || "UPDATE_ONE"
		}
		Where newDoc is the updated/new document to replace duplicates with.
	
		PS: This Comment is only for information purpose, should be deleted later.
	
 */
router.put('/:dedupeId/action', async (req, res) => {
	try {
		let user = req.headers[global.userHeader];
		let dedupeId = req.params.dedupeId;
		let { action, dedupeItems } = req.body;
		let dedupeItemIds = dedupeItems.map(item => item._id);
		let docs = await model.find({ _id: { $in: dedupeItemIds }, dedupeId });
		if (!docs.length) {
			return res.status(404).json({
				message: 'No Dedupe Records With Given IDs'
			});
		}
		let failedItems = [], successItems = [];
		let promises = docs.map(async (doc) => {
			let dedupeItem = dedupeItems.find(item => item._id == doc._id);
			if (user !== doc.user) {
				dedupeItem['message'] = 'User can act on his own dedupe records only.';
				failedItems.push(dedupeItem);
				return;
			}
			doc.action = action;
			if (action == 'MARK_ONE') {
				doc.newDoc = doc.docs.find(d => d._id == dedupeItem.newDoc._id);
			} else if (action == 'CREATE_NEW' || action == 'UPDATE_ONE') {
				doc.newDoc = dedupeItem.newDoc;
			}
			await doc.save();
			successItems.push(dedupeItem);
		});
		docs = await Promise.all(promises);
		return res.json({
			successItems,
			failedItems,
			action
		});
	} catch (e) {
		let err = e;
		logger.error('Error in /:dedupeId/action/ :: ', err);
		if (typeof e === 'string') {
			err = new Error(e);
		}
		res.status(500).json({
			message: err.message
		});
	}
});

router.put('/:dedupeId/apply', async (req, res) => {
	let txnId = req.headers[global.txnIdHeader];
	let user = req.headers[global.userHeader];
	let dedupeId = req.params.dedupeId;
	let dedupeFields = specialFields.dedupeFields;
	try {
		// Check if there is any pending dedupe item for action
		let pendingDedupeItems = await model.countDocuments({
			dedupeId,
			user,
			action: 'PENDING'
		});
		if (pendingDedupeItems > 0) {
			return res.status(400).json({
				message: `You have ${pendingDedupeItems} pending dedupes item/s for action.`
			});
		}
		// To block read operations
		informGW({
			serviceId: config.serviceId,
			status: 'PROCESSING'
		}, req.get('Authorization'));
		res.status(202).json({ _id: dedupeId, message: 'Applying Dedupe actions.' });
		const result = await threadUtils.executeThread(txnId, 'dedupe-apply', {
			dedupeId,
			dedupeFields,
			reqData: {
				headers: req.headers,
				rawHeaders: req.rawHeaders,
				user: req.user
			}
		});
		logger.info(`[${txnId}] : Apply Dedupe ID ${dedupeId} result :: `, result);
		// To unblock all operations
		informGW({
			serviceId: config.serviceId,
			status: 'COMPLETED'
		}, req.get('Authorization'));
	} catch (e) {
		let err = e;
		logger.error(`[${txnId}] :: Error in starting dedupe apply process `, err);
		if (typeof e === 'string') {
			err = new Error(e);
		}
		if (!res.headersSent) {
			res.status(500).json({
				message: err.message
			});
		}
	}
});

function informGW(data, jwtToken) {

	var options = {
		url: config.baseUrlGW + '/gw/dedupe/status',
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': jwtToken
		},
		json: true,
		body: data
	};
	httpClient.httpRequest(options);

}

module.exports = router;