const router = require('express').Router();
const mongoose = require('mongoose');
const log4js = require('log4js');
const _ = require('lodash');

const config = require('../../config');
const specialFields = require('../utils/special-fields.utils');
const crudderUtils = require('../utils/crudder.utils');
const { modifySecureFieldsFilter } = require('./../utils/common.utils');

const logger = log4js.getLogger(global.loggerName);

const model = mongoose.model(config.serviceId);
let softDeletedModel;
if (!config.permanentDelete) {
	softDeletedModel = mongoose.model(config.serviceId + '.deleted');
}

router.put('/update', async (req, res) => {
	if (!specialFields.hasPermissionForPUT(req, req.user.appPermissions)) {
		return res.status(403).json({
			message: 'You don\'t have permission to update records',
		});
	}

	try {
		addExpireAt(req);
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}

	const txnId = req.get(global.txnIdHeader);
	let ids = req.query.ids;
	if (ids && typeof ids == 'string') {
		ids = _.trim(ids);
		if (ids) {
			ids = ids.split(',');
		}
	}
	if (_.isArray(ids) && ids.length == 0) {
		ids = null;
	}
	const payload = req.body;
	let userFilter = req.query.filter;
	let errors = {};
	try {
		if (userFilter) {
			userFilter = JSON.parse(decodeURIComponent(userFilter));
			const tempFilter = await specialFields.patchRelationInFilter(req, userFilter, errors);
			logger.debug('Filter After Patching Relation:', JSON.stringify(tempFilter));
			if (Array.isArray(tempFilter) && tempFilter.length > 0) {
				userFilter = tempFilter[0];
			} else if (tempFilter) {
				userFilter = tempFilter;
			}
			if (errors && Object.keys(errors).length > 0) {
				logger.error('Error while fetching relation: ', JSON.stringify(errors));
			}
			userFilter = modifySecureFieldsFilter(userFilter, specialFields.secureFields, false);
			logger.debug('Filter After Patching Secure Fields:', JSON.stringify(userFilter));
		}
	} catch (e) {
		logger.error(e);
		return res.status(400).json({ message: e });
	}
	if (userFilter) {
		userFilter = crudderUtils.parseFilter(userFilter);
		logger.debug('Filter After Parsing:', JSON.stringify(userFilter));
	}

	if ((!ids || ids.length == 0) && (!userFilter || _.isEmpty(userFilter))) {
		return res.status(400).json({
			message: 'Invalid Request, Not sure which all records to update',
		});
	}

	if (!payload || _.isEmpty(payload)) {
		return res.status(400).json({
			message: 'Invalid Request, No Body Found',
		});
	}

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
		if (!payload._metadata) {
			payload._metadata = {};
		}
		if (!payload._metadata.lastUpdated) {
			payload._metadata.lastUpdated = new Date();
		}
		logger.debug('Final Filter:', JSON.stringify(filter));
		const status = await model.updateMany(filter, { $set: payload });
		return res.status(200).json(status);
	} catch (err) {
		logger.error(err);
		handleError(res, err, txnId);
	}
});

router.delete('/delete', async (req, res) => {
	if (!specialFields.hasPermissionForDELETE(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		return res.status(403).json({
			message: 'You don\'t have permission to delete records',
		});
	}

	const txnId = req.get(global.txnIdHeader);
	let ids = req.query.ids || req.body.ids;
	if (ids && typeof ids == 'string') {
		ids = _.trim(ids);
		if (ids) {
			ids = ids.split(',');
		}
	}
	if (_.isArray(ids) && ids.length == 0) {
		ids = null;
	}
	let userFilter = req.query.filter || req.body.filter;
	let errors = {};
	try {
		if (userFilter) {
			userFilter = JSON.parse(decodeURIComponent(userFilter));
			const tempFilter = await specialFields.patchRelationInFilter(req, userFilter, errors);
			logger.debug('Filter After Patching Relation:', JSON.stringify(tempFilter));
			if (Array.isArray(tempFilter) && tempFilter.length > 0) {
				userFilter = tempFilter[0];
			} else if (tempFilter) {
				userFilter = tempFilter;
			}
			if (errors && Object.keys(errors).length > 0) {
				logger.error('Error while fetching relation: ', JSON.stringify(errors));
			}
			userFilter = modifySecureFieldsFilter(userFilter, specialFields.secureFields, false);
			logger.debug('Filter After Patching Secure Fields:', JSON.stringify(userFilter));
		}
	} catch (e) {
		logger.error(e);
		return res.status(400).json({ message: e });
	}
	if (userFilter) {
		userFilter = crudderUtils.parseFilter(userFilter);
		logger.debug('Filter After Parsing:', JSON.stringify(userFilter));
	}

	if ((!ids || ids.length == 0) && (!userFilter || _.isEmpty(userFilter))) {
		return res.status(400).json({
			message: 'Invalid Request, Not sure what to delete',
		});
	}

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

		if (!config.permanentDelete) {
			const docs = await model.find(filter).lean();
			await softDeletedModel.insertMany(docs);
		}
		logger.debug('Final Filter:', JSON.stringify(filter));
		const result = await model.deleteMany(filter);
		return res.status(200).json(result);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.post('/insert', async (req, res) => {
	if (!specialFields.hasPermissionForPOST(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		return res.status(403).json({
			message: 'You don\'t have permission to delete records',
		});
	}

	try {
		addExpireAt(req);
	} catch (err) {
		return res.status(400).json({ message: err.message });
	}

	const txnId = req.get(global.txnIdHeader);
	const payload = req.body;

	if (!payload || _.isEmpty(payload) || !_.isArray(payload)) {
		return res.status(400).json({
			message: 'Invalid Request, No Body Found',
		});
	}

	try {
		const result = await model.insertMany(payload);
		return res.status(200).json(result);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

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
