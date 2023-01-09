const mongoose = require('mongoose');
const _ = require('lodash');
const moment = require('moment');

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
const fileFields = []
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
		schema.index({ "url": "text", "name": "text", "manufacturers": "text", "stock": "text", "introduction": "text", "benefits": "text", "label": "text" }, { name: 'text_search' });
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
 * @param {*} filter The Filter Object
 * @param {*} errors The errors while fetching RefIds
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function patchRelationInWorkflowFilter(req, filter, errors) {
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
			if (!flag) {
				if (typeof filter[key] == 'object' && filter[key]) {
					if (Array.isArray(filter[key])) {
						const promiseArr = filter[key].map(async (item, i) => {
							return await patchRelationInWorkflowFilter(req, item, errors);
						});
						tempFilter[key] = (await Promise.all(promiseArr)).filter(e => e ? Object.keys(e).length : 0);
					} else {
						tempFilter[key] = await patchRelationInWorkflowFilter(req, filter[key], errors);
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
	if (process.env.SKIP_AUTH == 'true' || process.env.SKIP_AUTH == 'TRUE') {
		return true;
	}
	if (req.user && req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC2005'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P1857467316"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForPOST = hasPermissionForPOST;
function hasPermissionForPUT(req, permissions) {
	if (process.env.SKIP_AUTH == 'true' || process.env.SKIP_AUTH == 'TRUE') {
		return true;
	}
	if (req.user && req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC2005'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P1857467316"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForPUT = hasPermissionForPUT;
function hasPermissionForDELETE(req, permissions) {
	if (process.env.SKIP_AUTH == 'true' || process.env.SKIP_AUTH == 'TRUE') {
		return true;
	}
	if (req.user && req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC2005'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P1857467316"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForDELETE = hasPermissionForDELETE;
function hasPermissionForGET(req, permissions) {
	if (process.env.SKIP_AUTH == 'true' || process.env.SKIP_AUTH == 'TRUE') {
		return true;
	}
	if (req.user && req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC2005'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P1857467316","P1120635501"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForGET = hasPermissionForGET;

function filterByPermission(req, permissions, data) {
	if (process.env.SKIP_AUTH == 'true' || process.env.SKIP_AUTH == 'TRUE') {
		return data;
	}
	if (req.user && req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return data;
	}
	if (_.intersection(['ADMIN_SRVC2005'], permissions).length > 0) {
		return data;
	}
	if (_.intersection([], permissions).length > 0) {
		return data;
	}
	if (_.intersection(["P1857467316","P1120635501"], permissions).length == 0) {
		_.unset(data, '_id');
	}
	if (_.intersection(["P1857467316","P1120635501"], permissions).length == 0) {
		_.unset(data, 'url');
	}
	if (_.intersection(["P1857467316","P1120635501"], permissions).length == 0) {
		_.unset(data, 'name');
	}
	if (_.intersection(["P1857467316","P1120635501"], permissions).length == 0) {
		_.unset(data, 'manufacturers');
	}
	if (_.intersection(["P1857467316","P1120635501"], permissions).length == 0) {
		_.unset(data, 'stock');
	}
	if (_.intersection(["P1857467316","P1120635501"], permissions).length == 0) {
		_.unset(data, 'introduction');
	}
	if (_.intersection(["P1857467316","P1120635501"], permissions).length == 0) {
		_.unset(data, 'benefits');
	}
	if (_.intersection(["P1857467316","P1120635501"], permissions).length == 0) {
		_.unset(data, 'label');
	}
		return data;
}


async function getDynamicFilter(req, data) {
	let filter;
	let allFilters = [];
	if (_.intersection(['ADMIN_SRVC2005'], (req.user && req.user.appPermissions ? req.user.appPermissions : [])).length > 0) {
		return null;
	}
	if (process.env.SKIP_AUTH == 'true' || process.env.SKIP_AUTH == 'TRUE') {
		return null;
	}
	if (allFilters && allFilters.length > 0) {
		logger.debug('Dynamic Filter Applied', JSON.stringify(allFilters));
		return { $and: allFilters };
	} else {
		logger.debug('Dynamic Filter Not Applied.');
		return null;
	}
}

function getDateRangeObject(date) {
	if (date) {
		const filter = {};
		const temp = moment.utc(date);
		temp.startOf('date');
		filter['$gte'] = temp.utc().toISOString();
		temp.endOf('date');
		filter['$lte'] = temp.utc().toISOString();
		return filter;
	}
	return null;
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
module.exports.patchRelationInWorkflowFilter = patchRelationInWorkflowFilter;
module.exports.fixBoolean = fixBoolean;
module.exports.enrichGeojson = enrichGeojson;
module.exports.validateDateFields = validateDateFields;
module.exports.cascadeRelation = cascadeRelation;
module.exports.filterByPermission = filterByPermission;
module.exports.getDynamicFilter = getDynamicFilter;