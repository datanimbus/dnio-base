const createOnlyFields = [];
const precisionFields = [];
const secureFields = [];
const uniqueFields = [];
const relationUniqueFields = [];
const relationRequiredFields = [];

/**
 * 
 * @param {*} newData The Current Data that needs to be updated
 * @param {*} oldData The Old Data existing in the DB
 * @returns {object} 
 */
function validateCreateOnly(newData, oldData) {
	const errorPath = {};
	if (newData && oldData) {
		if (newData.someCreateOnly !== oldData.someCreateOnly) {
			errorPath.someCreateOnly = true;
		}
	}
	return Object.keys(errorPath).length > 0 ? errorPath : null;
}

/**
 * 
 * @param {*} newData The Current Data that needs to be updated
 * @param {*} oldData The Old Data existing in the DB
 * @returns {Promise<object>}
 */
function validateRelation(newData, oldData) {
	const errorPath = {};
	if (newData && oldData) {
		if (newData.someCreateOnly !== oldData.someCreateOnly) {
			errorPath.someCreateOnly = true;
		}
	}
	return Object.keys(errorPath).length > 0 ? errorPath : null;
}

/**
 * 
 * @param {*} newData The Current Data that needs to be updated
 * @param {*} oldData The Old Data existing in the DB
 * @returns {Promise<object>}
 */
function validateUnique(newData, oldData) {
	const errorPath = {};
	if (newData && oldData) {
		if (newData.someCreateOnly !== oldData.someCreateOnly) {
			errorPath.someCreateOnly = true;
		}
	}
	return Object.keys(errorPath).length > 0 ? errorPath : null;
}


function patchRelationInFilter() {

}

function patchRelationInWorkflowFilter() {

}

function expandDocument() {

}

function encryptSecureFields() {

}

function decryptSecureFields() {

}

function mongooseUniquePlugin() {

}

function fixBoolean() {

}

function enrichGeojson() {

}

function validateDateFields() {

}

function hasPermissionForPOST(permissions) {
	return true;
}
module.exports.hasPermissionForPOST = hasPermissionForPOST;
function hasPermissionForPUT(permissions) {
	return true;
}
module.exports.hasPermissionForPUT = hasPermissionForPUT;
function hasPermissionForDELETE(permissions) {
	return true;
}
module.exports.hasPermissionForDELETE = hasPermissionForDELETE;
function hasPermissionForGET(permissions) {
	return true;
}
module.exports.hasPermissionForGET = hasPermissionForGET;

function filterByPermission(permissions, data) {
}

function getNextWFStep(req, currStep) {

}

const hasWFPermissionFor = {};

module.exports.createOnlyFields = createOnlyFields;
module.exports.precisionFields = precisionFields;
module.exports.secureFields = secureFields;
module.exports.uniqueFields = uniqueFields;
module.exports.relationUniqueFields = relationUniqueFields;
module.exports.relationRequiredFields = relationRequiredFields;
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
module.exports.mongooseUniquePlugin = mongooseUniquePlugin;
module.exports.filterByPermission = filterByPermission;
module.exports.getNextWFStep = getNextWFStep;
module.exports.hasWFPermissionFor = hasWFPermissionFor