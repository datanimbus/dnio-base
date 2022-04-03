const mongoose = require('mongoose');
const _ = require('lodash');

const config = require('../../config');
const httpClient = require('../../http-client');
const commonUtils = require('./common.utils');

const logger = global.logger;
const createOnlyFields = ''.split(',');
const precisionFields = [{"field":"age","precision":2}];
const secureFields = 'password'.split(',');
const uniqueFields = [];
const relationUniqueFields = ''.split(',');
const dateFields = [{"field":"date","dateType":"date","defaultTimezone":"Zulu"}]
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
		schema.index({ 'location.geometry': '2dsphere' }, { name: 'location_geoJson' });
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
	let userId = _.get(newData, 'user._id')
	if (userId) {
		try {
			const doc = await commonUtils.getUserDoc(req, userId);
				if (!doc) {
					errors['user'] = userId + ' not found';
				} else {
					_.set(newData, 'user._href', doc._href);
				}
		} catch (e) {
			errors['user'] = e.message ? e.message : e;
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
	let userId = _.get(newData, 'user._id');
	if (userId) {
		try {
			if (!expandForSelect || (expandForSelect && commonUtils.isExpandAllowed(req, 'user'))) {
			const doc = await commonUtils.getUserDoc(req, userId);
				if (!doc) {
					errors['user'] = userId + ' not found';
				} else {
					_.set(newData, 'user.basicDetails', doc.basicDetails);
					_.set(newData, 'user.attributes', doc.attributes);
					_.set(newData, 'user.username', doc.username);
					_.set(newData, 'user._id', doc._id);
				}
			}
		} catch (e) {
					_.set(newData, 'user', null);
			errors['user'] = e.message ? e.message : e;
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
 * @param {*} newData The New Document Object
 * @param {*} oldData The Old Document Object
 * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths
 */
async function encryptSecureFields(req, newData, oldData) {
	const errors = {};
	let passwordValueNew = _.get(newData, 'password.value')
	let passwordValueOld = _.get(oldData, 'password.value')
	if (passwordValueNew && passwordValueNew != passwordValueOld) {
		try {
			const doc = await commonUtils.encryptText(req, passwordValueNew);
			if (doc) {
				_.set(newData, 'password', doc);
			}
		} catch (e) {
			errors['password'] = e.message ? e.message : e;
		}
	}
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
	let passwordValue = _.get(newData, 'password.value')
	if (passwordValue) {
		try {
			const doc = await commonUtils.decryptText(req, passwordValue);
			if (doc) {
				if(req.query && req.query.forFile) {
					_.set(newData, 'password', doc);
				} else {
					_.set(newData, 'password.value', doc);
				}
			}
		} catch (e) {
			errors['password'] = e.message ? e.message : e;
		}
	}
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
	let locationNew = _.get(newData, 'location')
	let locationOld = _.get(oldData, 'location')
	if (locationNew && !_.isEqual(locationNew,locationOld)) {
		try {
			const doc = await commonUtils.getGeoDetails(req, 'location', locationNew);
			if (doc) {
				_.set(newData, 'location', doc.geoObj);
			}
		} catch (e) {
			// errors['location'] = e.message ? e.message : e;
		}
	}
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
	let dateDefaultTimezone = 'Zulu';
	let dateSupportedTimezones = [];
	let dateNew = _.get(newData, 'date')
	let dateOld = _.get(oldData, 'date')
	if (typeof dateNew === 'string') {
		dateNew = {
			rawData: dateNew
		};
	}
	if (typeof dateOld === 'string') {
		dateOld = {
			rawData: dateOld
		};
	}
	if (!_.isEqual(dateNew, dateOld)) {
		try {
			dateNew = commonUtils.getFormattedDate(txnId, dateNew, dateDefaultTimezone, dateSupportedTimezones);
			_.set(newData, 'date', dateNew);
		} catch (e) {
			errors['date'] = e.message ? e.message : e;
		}
	}
	return Object.keys(errors).length > 0 ? errors : null;
}

function hasPermissionForPOST(req, permissions) {
	if (req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC5442'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P6523530854"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForPOST = hasPermissionForPOST;
function hasPermissionForPUT(req, permissions) {
	if (req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC5442'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P6523530854"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForPUT = hasPermissionForPUT;
function hasPermissionForDELETE(req, permissions) {
	if (req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC5442'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P6523530854"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForDELETE = hasPermissionForDELETE;
function hasPermissionForGET(req, permissions) {
	if (req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return true;
	}
	if (_.intersection(['ADMIN_SRVC5442'], permissions).length > 0) {
		return true;
	}
	if (_.intersection(["P6523530854","P2191523098"], permissions).length > 0) {
		return true;
	}
	return false;
}
module.exports.hasPermissionForGET = hasPermissionForGET;

function filterByPermission(req, permissions, data) {
	if (req.user.apps && req.user.apps.indexOf(config.app) > -1) {
		return data;
	}
	if (_.intersection(['ADMIN_SRVC5442'], permissions).length > 0) {
		return data;
	}
	if (_.intersection([], permissions).length > 0) {
		return data;
	}
	if (_.intersection(["P6523530854","P2191523098"], permissions).length == 0) {
		_.unset(data, '_id');
	}
	if (_.intersection(["P6523530854","P2191523098"], permissions).length == 0) {
		_.unset(data, 'name');
	}
	if (_.intersection(["P6523530854","P2191523098"], permissions).length == 0) {
		_.unset(data, 'age');
	}
	if (_.intersection(["P6523530854","P2191523098"], permissions).length == 0) {
		_.unset(data, 'date');
	}
	if (_.intersection(["P6523530854","P2191523098"], permissions).length == 0) {
		_.unset(data, 'boolean');
	}
	if (_.intersection(["P6523530854","P2191523098"], permissions).length == 0) {
		_.unset(data, 'location');
	}
	if (_.intersection(["P6523530854","P2191523098"], permissions).length == 0) {
		_.unset(data, 'file');
	}
	if (_.intersection(["P6523530854","P2191523098"], permissions).length == 0) {
		_.unset(data, 'user');
	}
	if (_.intersection(["P6523530854","P2191523098"], permissions).length == 0) {
		_.unset(data, 'password');
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