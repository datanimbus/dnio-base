const mongoose = require('mongoose');
const _ = require('lodash');

const config = require('../../config');
const httpClient = require('../../http-client');
const commonUtils = require('./common.utils');

const logger = global.logger;
const createOnlyFields = ''.split(',');
const precisionFields = [];
const secureFields = ''.split(',');
const uniqueFields = [];
const relationUniqueFields = ''.split(',');
const dateFields = []
/**
 * @param {*} req The Incomming Request Object
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @param {boolean} [forceRemove] Will remove all createOnly field
 * @returns {object | null} Returns null if no validation error, else and error object with invalid paths
 */
function validateCreateOnly(req, newData, oldData, forceRemove) {
	const errors = {};
	if (oldData) {
	}
	return Object.keys(errors).length > 0 ? errors : null;
}

function mongooseUniquePlugin() {
	return function (schema) {
	}
}

/**
 * @param {*} req The Incomming Request Object
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function validateUnique(req, newData, oldData) {
	const model = mongoose.model(config.serviceId);
	const errors = {};
	let val;
	return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * @param {*} req The Incomming Request Object
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function validateRelation(req, newData, oldData) {
	const errors = {};
	let testDsId = _.get(newData, 'testDs._id')
	if (testDsId) {
		try {
			const doc = await commonUtils.getServiceDoc(req, 'SRVC5442', testDsId, true);
				if (!doc) {
					errors['testDs'] = testDsId + ' not found';
				} else {
					_.set(newData, 'testDs._href', doc._href);
				}
		} catch (e) {
			errors['testDs'] = e.message ? e.message : e;
		}
	}
	return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * @param {*} req The Incomming Request Object
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @param {boolean} expandForSelect Expand only for select
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function expandDocument(req, newData, oldData, expandForSelect) {
	const errors = {};
	let testDsId = _.get(newData, 'testDs._id');
	if (testDsId) {
		try {
			if (!expandForSelect || (expandForSelect && commonUtils.isExpandAllowed(req, 'testDs'))) {
				const doc = await commonUtils.getServiceDoc(req, 'SRVC5442', testDsId);
				if (doc) {
					doc._id = testDsId;
					_.set(newData, 'testDs', doc);
				}
			}
		} catch (e) {
					_.set(newData, 'testDs', null);
			errors['testDs'] = e.message ? e.message : e;
		}
	}
	return newData;
}

/**
 * @param {*} req The Incomming Request Object
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @param {boolean} expandForSelect Expand only for select
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function cascadeRelation(req, newData, oldData) {
	const errors = {};
	if (!req.query.cascade || req.query.cascade != 'true') {
		return null;
	}
	let testDs = _.get(newData, 'testDs');
	if (!_.isEmpty(testDs)) {
		try {
			const doc = await commonUtils.upsertDocument(req, 'SRVC5442', testDs);
			if (doc) {
				_.set(newData, 'testDs', doc);
			}
		} catch (e) {
			errors['testDs'] = e.message ? e.message : e;
		}
	}
	return null;
}

/**
 * @param {*} req The Incomming Request Object
 * @param {*} filter The Filter Object
 * @param {*} errors The errors while fetching RefIds
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function patchRelationInFilter(req, filter, errors) {
	if (!errors) {
		errors = {};
	}
	try {
		if (typeof filter !== 'object') {
			return filter;
		}
		let flag = 0;
		const tempFilter = {};
		let promises = Object.keys(filter).map(async (key) => {
			if (key.startsWith('testDs')) {
				try {
					const tempKey = key.split('testDs.')[1];
					const ids = await commonUtils.getDocumentIds(req, 'SRVC5442', { [tempKey]: filter[key] })
					if (ids && ids.length > 0) {
						if (!tempFilter['testDs._id'] || !tempFilter['testDs._id']['$in']) {
							tempFilter['testDs._id'] = { $in: ids };
						} else {
							tempFilter['testDs._id']['$in'] = tempFilter['testDs._id']['$in'].concat(ids);
						}
					} else {
						tempFilter[key] = filter[key]
					}
					flag = true;
				} catch (e) {
					errors['testDs'] = e.message ? e.message : e;
				}
			}
			if (!flag) {
				if (typeof filter[key] == 'object' && filter[key]) {
					if (Array.isArray(filter[key])) {
						const promiseArr = filter[key].map(async (item, i) => {
							return await patchRelationInFilter(req, item, errors);
						});
						tempFilter[key] = (await Promise.all(promiseArr)).filter(e => e ? Object.keys(e).length : 0);
					} else {
						tempFilter[key] = await patchRelationInFilter(req, filter[key], errors);
					}
				} else {
					tempFilter[key] = filter[key]
				}
			}
		});
		promises = await Promise.all(promises);
		promises = null;
		return tempFilter;
	} catch (e) {
		throw e;
	}
}

/**
 * @param {*} req The Incomming Request Object
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function encryptSecureFields(req, newData, oldData) {
	const errors = {};
	return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * @param {*} req The Incomming Request Object
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function decryptSecureFields(req, newData, oldData) {
	const errors = {};
	return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * @param {*} req The Incoming Request Object
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
function fixBoolean(req, newData, oldData) {
	const errors = {};
	const trueBooleanValues = global.trueBooleanValues;
	const falseBooleanValues = global.falseBooleanValues;
	return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * @param {*} req The Incomming Request Object
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function enrichGeojson(req, newData, oldData) {
	const errors = {};
	return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * @param {*} req The Incomming Request Object
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function validateDateFields(req, newData, oldData) {
	let txnId = req.headers['txnid'];
	const errors = {};
	return Object.keys(errors).length > 0 ? errors : null;
}

function hasPermissionForPOST(req, permissions) {
	if (req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC5444'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P1034840569"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForPOST = hasPermissionForPOST;
function hasPermissionForPUT(req, permissions) {
	if (req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC5444'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P1034840569"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForPUT = hasPermissionForPUT;
function hasPermissionForDELETE(req, permissions) {
	if (req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC5444'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P1034840569"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForDELETE = hasPermissionForDELETE;
function hasPermissionForGET(req, permissions) {
	if (req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC5444'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P1034840569","P4834457907"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForGET = hasPermissionForGET;

function filterByPermission(req, permissions, data) {
	if (req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return data;
	}
	if (_.intersection(['ADMIN_SRVC5444'], permissions).length > 0) {
		return data;
	}
	if (_.intersection([], permissions).length > 0) {
		return data;
	}
	if (_.intersection(["P1034840569","P4834457907"], permissions).length == 0) {
		_.unset(data, '_id');
	}
	if (_.intersection(["P1034840569","P4834457907"], permissions).length == 0) {
		_.unset(data, 'name');
	}
	if (_.intersection(["P1034840569","P4834457907"], permissions).length == 0) {
		_.unset(data, 'testDs._id');
	}
		return data;
}

module.exports.createOnlyFields = createOnlyFields;
module.exports.precisionFields = precisionFields;
module.exports.secureFields = secureFields;
module.exports.uniqueFields = uniqueFields;
module.exports.relationUniqueFields = relationUniqueFields;
module.exports.dateFields = dateFields;
module.exports.mongooseUniquePlugin = mongooseUniquePlugin;
module.exports.validateCreateOnly = validateCreateOnly;
module.exports.validateRelation = validateRelation;
module.exports.validateUnique = validateUnique;
module.exports.expandDocument = expandDocument;
module.exports.encryptSecureFields = encryptSecureFields;
module.exports.decryptSecureFields = decryptSecureFields;
module.exports.patchRelationInFilter = patchRelationInFilter;
module.exports.fixBoolean = fixBoolean;
module.exports.enrichGeojson = enrichGeojson;
module.exports.validateDateFields = validateDateFields;
module.exports.cascadeRelation = cascadeRelation;
module.exports.filterByPermission = filterByPermission;