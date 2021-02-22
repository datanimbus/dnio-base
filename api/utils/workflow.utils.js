const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const mongoose = require('mongoose');
const utils = require('@appveen/utils');

const config = require('../../config');
const hooksUtils = require('./hooks.utils');
const specialFields = require('./special-fields.utils');
const commonUtils = require('./common.utils');

const logger = global.logger;
const configDB = global.authorDB;


/**
 * @returns {Promise<string[]>} Returns Array of userIds
 */
function getApproversList() {
	async function execute() {
		try {
			const roleIds = [];
			const role = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'role.json'), 'utf-8'));
			if (!role || role._id != config.serviceId || !role.roles || role.roles.length == 0) {
				return [];
			} else {
				role.roles.forEach(r => {
					if (r.operations.find(o => o.method == 'REVIEW')) {
						roleIds.push(r.id);
					}
				});
				const groups = await configDB.collection('userMgmt.groups').find({ 'roles.id': { $in: roleIds } }).toArray();
				let usersArr = groups.map(g => g.users);
				return _.uniq([].concat.apply([], usersArr));
			}
		} catch (err) {
			logger.error('workflow.utils>getApproversList', err);
			return [];
		}
	}
	return execute().catch(err => {
		logger.error('workflow.utils>getApproversList', err);
		return [];
	});
}

/**
 * @returns {boolean} Returns true/false
 */
function isWorkflowEnabled() {
	let flag = false;
	try {
		const role = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'role.json'), 'utf-8'));
		if (!role || role._id != config.serviceId) {
			flag = false;
		} else {
			if (role.roles && role.roles.length > 0 && role.roles.find(r => r.operations.find(o => o.method == 'REVIEW'))) {
				flag = true;
			} else {
				flag = false;
			}
		}
	} catch (err) {
		logger.error('workflow.utils>isWorkflowEnabled', err);
		flag = false;
	}
	return flag;
}

/**
 * @returns {Promise<boolean>} Returns a boolean Promise
 */
function hasSkipReview(req) {
	async function execute() {
		try {
			const userId = req.headers[global.userHeader];
			if (!userId) {
				logger.debug('UserID not found in request');
				return false;
			}
			const roleIds = [];
			const role = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'role.json'), 'utf-8'));
			if (!role || role._id != config.serviceId || !role.roles || role.roles.length == 0) {
				return [];
			} else {
				role.roles.forEach(r => {
					if (r.operations.find(o => o.method == 'SKIP_REVIEW')) {
						roleIds.push(r.id);
					}
				});
				const groups = await configDB.collection('userMgmt.groups').find({ 'roles.id': { $in: roleIds }, 'users': userId }).toArray();
				if (groups && groups.length > 0) {
					return true;
				} else {
					return false;
				}
			}
		} catch (err) {
			logger.error('workflow.utils>hasSkipReview', err);
			return [];
		}
	}
	return execute().catch(err => {
		logger.error('workflow.utils>hasSkipReview', err);
		return [];
	});
}

function getWorkflowItem(req, operation, _id, status, newDoc, oldDoc) {
	return {
		serviceId: config.serviceId,
		documentId: _id,
		operation: operation,
		requestedBy: req.headers[global.userHeader],
		app: config.app,
		audit: [],
		status: status,
		data: {
			old: oldDoc ? (oldDoc) : null,
			new: newDoc ? (newDoc) : null,
		}
	};
}


/**
 * @param {*} req The Incomming Request Object
 * @param {*} data The Data to simulate
 * @param {Object} [options] Other Options for simulation
 * @param {boolean} [options.generateId] Should generate new _id only for POST
 * @param {boolean} [options.simulate] Simulation Flag
 * @param {string} [options.operation] Operation for which simulate is called : POST/PUT/GET
 * @param {string} [options.trigger] Trigger for this simulate presave/submit/approve
 * @param {string} [options.docId] Document ID
 * @param {string} [options.source] Alias of trigger
 */
function simulate(req, data, options) {
	const model = mongoose.model(config.serviceId);
	if (!options) {
		options = {};
	}
	options.simulate = true;
	// data = new model(data).toObject(); // Type Casting as per schema.
	let promise = Promise.resolve(data);
	let oldData;
	if (!data._id && options.generateId) {
		promise = utils.counter.generateId(config.ID_PREFIX, config.serviceCollection, config.ID_SUFFIX, config.ID_PADDING, config.ID_COUNTER).then(id => {
			data._id = id;
			return data;
		});
	} else if (data._id && options.operation == 'PUT') {
		promise = model.findOne({ _id: data._id }).lean(true).then(_d => {
			oldData = _d;
			return _.assign(JSON.parse(JSON.stringify(_d)), data);
		});
	}
	return promise.then((newData) => {
		data = newData;
		return schemaValidation(req, data, oldData).catch(err => modifyError(err, 'schema'));
	}).then((newData) => {
		data = newData;
		return hooksUtils.callAllPreHooks(req, data, options).catch(err => modifyError(err, 'preHook'));
	}).then(newData => {
		data = newData;
		return schemaValidation(req, data, oldData).catch(err => modifyError(err, 'schema'));
	}).then((newData) => {
		data = newData;
		return uniqueValidation(req, data, oldData).catch(err => modifyError(err, 'unique'));
	}).then(() => {
		return createOnlyValidation(req, data, oldData).catch(err => modifyError(err, 'createOnly'));
	}).then(() => {
		return dateValidation(req, data, oldData).catch(err => modifyError(err, 'date'));
	}).then(() => {
		return relationValidation(req, data, oldData).catch(err => modifyError(err, 'relation'));
	}).then(() => {
		return enrichGeojson(req, data, oldData).catch(err => modifyError(err, 'geojson'));
	}).then(() => {
		return data;
	}).catch(err => {
		logger.error(err);
		throw err;
	});
}

/**
 * 
 * @param {*} err The Error Object of catch
 * @param {string} source Source of Error
 */
function modifyError(err, source) {
	const error = {};
	error.source = source;
	error.error = err;
	throw error;
}


/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function schemaValidation(req, newData, oldData) {
	const model = mongoose.model(config.serviceId);
	if (oldData) {
		newData = _.mergeWith(oldData, newData, commonUtils.mergeCustomizer);
		// newData = Object.assign(oldData, newData);
	}
	try {
		const errors = await specialFields.fixBoolean(req, newData, oldData);
		if (errors) {
			throw errors;
		}
	} catch (e) {
		logger.error('schemaValidation', e);
		throw e;
	}
	let modelData = new model(newData);
	modelData.isNew = false;
	logger.debug(JSON.stringify({ modelData }));
	try {
		await modelData.validate();
		return modelData.toObject();
	} catch (e) {
		logger.error('schemaValidation', e);
		throw e;
	}
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function dateValidation(req, newData, oldData) {
	try {
		const errors = await specialFields.validateDateFields(req, newData, oldData);
		if (errors) {
			throw errors;
		}
		return null;
	} catch (e) {
		logger.error('date', e);
		throw e;
	}
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function uniqueValidation(req, newData, oldData) {
	try {
		const errors = await specialFields.validateUnique(req, newData, oldData);
		if (errors) {
			throw errors;
		}
		return null;
	} catch (e) {
		logger.error('uniqueValidation', e);
		throw e;
	}
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function createOnlyValidation(req, newData, oldData) {
	try {
		const errors = specialFields.validateCreateOnly(req, newData, oldData, true);
		if (errors) {
			throw errors;
		}
		return null;
	} catch (e) {
		logger.error('createOnlyValidation', e);
		throw e;
	}
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function relationValidation(req, newData, oldData) {
	try {
		const errors = await specialFields.validateRelation(req, newData, oldData);
		if (errors) {
			throw errors;
		}
		return null;
	} catch (e) {
		logger.error('relationValidation', e);
		throw e;
	}
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function enrichGeojson(req, newData, oldData) {
	try {
		const errors = await specialFields.enrichGeojson(req, newData, oldData);
		if (errors) {
			throw errors;
		}
		return null;
	} catch (e) {
		logger.error('enrichGeojson', e);
		throw e;
	}
}

module.exports.getApproversList = getApproversList;
module.exports.isWorkflowEnabled = isWorkflowEnabled;
module.exports.hasSkipReview = hasSkipReview;
module.exports.getWorkflowItem = getWorkflowItem;
module.exports.simulate = simulate;