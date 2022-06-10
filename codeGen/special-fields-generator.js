const _ = require('lodash');

function genrateCode(config) {
	let schema = config.definition;
	// global.logger.info('schema :: defoiniton  ::', JSON.stringify(schema));
	if (typeof schema === 'string') {
		schema = JSON.parse(schema);
	}
	const code = [];
	code.push('const mongoose = require(\'mongoose\');');
	code.push('const _ = require(\'lodash\');');
	code.push('');
	code.push('const config = require(\'../../config\');');
	code.push('const httpClient = require(\'../../http-client\');');
	code.push('const commonUtils = require(\'./common.utils\');');
	code.push('');
	code.push('const logger = global.logger;');

	/**------------------------ SPECIAL FIELDS ----------------------- */
	code.push(`const createOnlyFields = '${config.createOnlyFields}'.split(',');`);
	code.push(`const precisionFields = ${JSON.stringify(config.precisionFields)};`);
	code.push(`const secureFields = '${config.secureFields}'.split(',');`);
	code.push(`const uniqueFields = ${JSON.stringify(config.uniqueFields)};`);
	code.push(`const relationUniqueFields = '${config.relationUniqueFields}'.split(',');`);
	code.push(`const dateFields = ${JSON.stringify((config.dateFields || []))}`);
	// code.push(`const relationRequiredFields = '${config.relationRequiredFields}'.split(',');`);

	/**------------------------ CREATE ONLY ----------------------- */
	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} newData The New Document Object');
	code.push(' * @param {*} oldData The Old Document Object');
	code.push(' * @param {boolean} [forceRemove] Will remove all createOnly field');
	code.push(' * @returns {object | null} Returns null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('function validateCreateOnly(req, newData, oldData, forceRemove) {');
	code.push('\tconst errors = {};');
	code.push('\tif (oldData) {');
	parseSchemaForCreateOnly(schema);
	code.push('\t}');
	code.push('\treturn Object.keys(errors).length > 0 ? errors : null;');
	code.push('}');
	code.push('');
	/**------------------------ UNIQUE ----------------------- */
	code.push('function mongooseUniquePlugin() {');
	code.push('\treturn function (schema) {');
	createIndex(schema);
	code.push('\t}');
	code.push('}');
	code.push('');
	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} newData The New Document Object');
	code.push(' * @param {*} oldData The Old Document Object');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('async function validateUnique(req, newData, oldData) {');
	code.push('\tconst model = mongoose.model(config.serviceId);');
	code.push('\tconst errors = {};');
	code.push('\tlet val;');
	parseSchemaForUnique(schema);
	code.push('\treturn Object.keys(errors).length > 0 ? errors : null;');
	code.push('}');
	code.push('');
	/**------------------------ RELATION VALIDATION ----------------------- */
	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} newData The New Document Object');
	code.push(' * @param {*} oldData The Old Document Object');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('async function validateRelation(req, newData, oldData) {');
	code.push('\tconst errors = {};');
	parseSchemaForRelation(schema);
	code.push('\treturn Object.keys(errors).length > 0 ? errors : null;');
	code.push('}');
	code.push('');
	/**------------------------ RELATION EXPAND ----------------------- */
	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} newData The New Document Object');
	code.push(' * @param {*} oldData The Old Document Object');
	code.push(' * @param {boolean} expandForSelect Expand only for select');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('async function expandDocument(req, newData, oldData, expandForSelect) {');
	code.push('\tconst errors = {};');
	parseSchemaForExpand(schema);
	code.push('\treturn newData;');
	code.push('}');
	code.push('');

	/**------------------------ RELATION CASCADE ----------------------- */
	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} newData The New Document Object');
	code.push(' * @param {*} oldData The Old Document Object');
	code.push(' * @param {boolean} expandForSelect Expand only for select');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('async function cascadeRelation(req, newData, oldData) {');
	code.push('\tconst errors = {};');
	code.push('\tif (!req.query.cascade || req.query.cascade != \'true\') {');
	code.push('\t\treturn null;');
	code.push('\t}');
	parseSchemaForCascadeRelation(schema);
	code.push('\treturn null;');
	code.push('}');
	code.push('');

	/**------------------------ RELATION FILTER ----------------------- */
	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} filter The Filter Object');
	code.push(' * @param {*} errors The errors while fetching RefIds');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('async function patchRelationInFilter(req, filter, errors) {');
	code.push('\tif (!errors) {');
	code.push('\t\terrors = {};');
	code.push('\t}');
	code.push('\ttry {');
	code.push('\t\tif (typeof filter !== \'object\') {');
	code.push('\t\t\treturn filter;');
	code.push('\t\t}');
	code.push('\t\tlet flag = 0;');
	code.push('\t\tconst tempFilter = {};');
	code.push('\t\tlet promises = Object.keys(filter).map(async (key) => {');
	parseSchemaForFilter(schema);
	code.push('\t\t\tif (!flag) {');
	code.push('\t\t\t\tif (typeof filter[key] == \'object\' && filter[key]) {');
	code.push('\t\t\t\t\tif (Array.isArray(filter[key])) {');
	code.push('\t\t\t\t\t\tconst promiseArr = filter[key].map(async (item, i) => {');
	code.push('\t\t\t\t\t\t\treturn await patchRelationInFilter(req, item, errors);');
	code.push('\t\t\t\t\t\t});');
	code.push('\t\t\t\t\t\ttempFilter[key] = (await Promise.all(promiseArr)).filter(e => e ? Object.keys(e).length : 0);');
	code.push('\t\t\t\t\t} else {');
	code.push('\t\t\t\t\t\ttempFilter[key] = await patchRelationInFilter(req, filter[key], errors);');
	code.push('\t\t\t\t\t}');
	code.push('\t\t\t\t} else {');
	code.push('\t\t\t\t\ttempFilter[key] = filter[key]');
	code.push('\t\t\t\t}');
	code.push('\t\t\t}');
	code.push('\t\t});');
	code.push('\t\tpromises = await Promise.all(promises);');
	code.push('\t\tpromises = null;');
	code.push('\t\treturn tempFilter;');
	code.push('\t} catch (e) {');
	code.push('\t\tthrow e;');
	code.push('\t}');
	code.push('}');
	code.push('');

	/**------------------------ WORKFLOW RELATION FILTER ----------------------- */
	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} filter The Filter Object');
	code.push(' * @param {*} errors The errors while fetching RefIds');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('async function patchRelationInWorkflowFilter(req, filter, errors) {');
	code.push('\tif (!errors) {');
	code.push('\t\terrors = {};');
	code.push('\t}');
	code.push('\ttry {');
	code.push('\t\tif (typeof filter !== \'object\') {');
	code.push('\t\t\treturn filter;');
	code.push('\t\t}');
	code.push('\t\tlet flag = 0;');
	code.push('\t\tconst tempFilter = {};');
	code.push('\t\tlet promises = Object.keys(filter).map(async (key) => {');
	parseSchemaForWorkflowFilter(schema);
	code.push('\t\t\tif (!flag) {');
	code.push('\t\t\t\tif (typeof filter[key] == \'object\' && filter[key]) {');
	code.push('\t\t\t\t\tif (Array.isArray(filter[key])) {');
	code.push('\t\t\t\t\t\tconst promiseArr = filter[key].map(async (item, i) => {');
	code.push('\t\t\t\t\t\t\treturn await patchRelationInWorkflowFilter(req, item, errors);');
	code.push('\t\t\t\t\t\t});');
	code.push('\t\t\t\t\t\ttempFilter[key] = (await Promise.all(promiseArr)).filter(e => e ? Object.keys(e).length : 0);');
	code.push('\t\t\t\t\t} else {');
	code.push('\t\t\t\t\t\ttempFilter[key] = await patchRelationInWorkflowFilter(req, filter[key], errors);');
	code.push('\t\t\t\t\t}');
	code.push('\t\t\t\t} else {');
	code.push('\t\t\t\t\ttempFilter[key] = filter[key]');
	code.push('\t\t\t\t}');
	code.push('\t\t\t}');
	code.push('\t\t});');
	code.push('\t\tpromises = await Promise.all(promises);');
	code.push('\t\tpromises = null;');
	code.push('\t\treturn tempFilter;');
	code.push('\t} catch (e) {');
	code.push('\t\tthrow e;');
	code.push('\t}');
	code.push('}');
	code.push('');

	/**------------------------ SECURE FIELD ENCRYPT ----------------------- */
	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} newData The New Document Object');
	code.push(' * @param {*} oldData The Old Document Object');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('async function encryptSecureFields(req, newData, oldData) {');
	code.push('\tconst errors = {};');
	parseSchemaForEncryption(schema);
	code.push('\treturn Object.keys(errors).length > 0 ? errors : null;');
	code.push('}');
	code.push('');
	/**------------------------ SECURE FIELD DECRYPT ----------------------- */
	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} newData The New Document Object');
	code.push(' * @param {*} oldData The Old Document Object');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('async function decryptSecureFields(req, newData, oldData) {');
	code.push('\tconst errors = {};');
	parseSchemaForDecryption(schema);
	code.push('\treturn Object.keys(errors).length > 0 ? errors : null;');
	code.push('}');
	code.push('');
	/**------------------------ FIX BOOLEAN ----------------------- */
	code.push('/**');
	code.push(' * @param {*} req The Incoming Request Object');
	code.push(' * @param {*} newData The New Document Object');
	code.push(' * @param {*} oldData The Old Document Object');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('function fixBoolean(req, newData, oldData) {');
	code.push('\tconst errors = {};');
	code.push('\tconst trueBooleanValues = global.trueBooleanValues;');
	code.push('\tconst falseBooleanValues = global.falseBooleanValues;');
	parseSchemaForBoolean(schema);
	code.push('\treturn Object.keys(errors).length > 0 ? errors : null;');
	code.push('}');
	code.push('');
	/**------------------------ ENRICH GEOJSON ----------------------- */
	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} newData The New Document Object');
	code.push(' * @param {*} oldData The Old Document Object');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('async function enrichGeojson(req, newData, oldData) {');
	code.push('\tconst errors = {};');
	parseSchemaForGeojson(schema);
	code.push('\treturn Object.keys(errors).length > 0 ? errors : null;');
	code.push('}');
	code.push('');

	/**----------------------- DATE FIELDS HANDLING------------------- */

	code.push('/**');
	code.push(' * @param {*} req The Incomming Request Object');
	code.push(' * @param {*} newData The New Document Object');
	code.push(' * @param {*} oldData The Old Document Object');
	code.push(' * @returns {Promise<object>} Returns Promise of null if no validation error, else and error object with invalid paths');
	code.push(' */');
	code.push('async function validateDateFields(req, newData, oldData) {');
	code.push('\tlet txnId = req.headers[\'txnid\'];');
	code.push('\tconst errors = {};');
	parseSchemaForDateFields(schema);
	code.push('\treturn Object.keys(errors).length > 0 ? errors : null;');
	code.push('}');
	code.push('');




	/**----------------------- ROLES AND PERMISSIONS------------------- */

	parseRolesForPermisison(config.role.roles, config.workflowConfig);
	code.push('');
	code.push('function filterByPermission(req, permissions, data) {');
	// //Super Admin Code
	// code.push('\tif (req.user.isSuperAdmin) {');
	// code.push('\t\treturn data;');
	// code.push('\t}');

	//App Admin Code
	code.push('\tif (req.user.apps && req.user.apps.indexOf(config.app) > -1) {');
	code.push('\t\treturn data;');
	code.push('\t}');

	//Data Service Admin Code
	code.push(`\tif (_.intersection(['ADMIN_${config._id}'], permissions).length > 0) {`);
	code.push('\t\treturn data;');
	code.push('\t}');

	//Reviewer Code
	let makerCheckersIds = [];
	if (config.workflowConfig && config.workflowConfig.makerCheckers && config.workflowConfig.makerCheckers[0]) {
		const steps = (config.workflowConfig.makerCheckers[0].steps || []);
		makerCheckersIds = steps.map(e => e.id);
	}
	code.push(`\tif (_.intersection(${JSON.stringify(makerCheckersIds)}, permissions).length > 0) {`);
	code.push('\t\treturn data;');
	code.push('\t}');

	parseFieldsForPermisison(config.role.fields);
	code.push('\t\treturn data;');
	code.push('}');
	code.push('');


	/**----------------------- MULTI-LEVEL WF------------------- */
	if (config.workflowConfig && config.workflowConfig.makerCheckers) {
		parseMultiLevelWF(config.workflowConfig.makerCheckers);
	}




	/**------------------------ EXPORTS ----------------------- */
	/**------------------------ CONSTANTS ----------------------- */
	code.push('module.exports.createOnlyFields = createOnlyFields;');
	code.push('module.exports.precisionFields = precisionFields;');
	code.push('module.exports.secureFields = secureFields;');
	code.push('module.exports.uniqueFields = uniqueFields;');
	code.push('module.exports.relationUniqueFields = relationUniqueFields;');
	code.push('module.exports.dateFields = dateFields;');
	// code.push('module.exports.relationRequiredFields = relationRequiredFields;');
	/**------------------------ METHODS ----------------------- */
	code.push('module.exports.mongooseUniquePlugin = mongooseUniquePlugin;');
	code.push('module.exports.validateCreateOnly = validateCreateOnly;');
	code.push('module.exports.validateRelation = validateRelation;');
	code.push('module.exports.validateUnique = validateUnique;');
	code.push('module.exports.expandDocument = expandDocument;');
	code.push('module.exports.encryptSecureFields = encryptSecureFields;');
	code.push('module.exports.decryptSecureFields = decryptSecureFields;');
	code.push('module.exports.patchRelationInFilter = patchRelationInFilter;');
	code.push('module.exports.patchRelationInWorkflowFilter = patchRelationInWorkflowFilter;');
	code.push('module.exports.fixBoolean = fixBoolean;');
	code.push('module.exports.enrichGeojson = enrichGeojson;');
	code.push('module.exports.validateDateFields = validateDateFields;');
	code.push('module.exports.cascadeRelation = cascadeRelation;');

	code.push('module.exports.filterByPermission = filterByPermission;');


	return code.join('\n');
	// fs.writeFileSync(path.join(process.cwd(), `generated`, `special-fields.utils.js`), code.join(`\n`), `utf-8`);

	function parseSchemaForRelation(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if ((def.properties.relatedTo || def.type == 'User') && def.type != 'Array') {
					code.push(`\tlet ${_.camelCase(path + '._id')} = _.get(newData, '${path}._id')`);
					code.push(`\tif (${_.camelCase(path + '._id')}) {`);
					code.push('\t\ttry {');
					if (def.properties.relatedTo)
						code.push(`\t\t\tconst doc = await commonUtils.getServiceDoc(req, '${def.properties.relatedTo}', ${_.camelCase(path + '._id')}, true);`);
					else
						code.push(`\t\t\tconst doc = await commonUtils.getUserDoc(req, ${_.camelCase(path + '._id')});`);
					code.push('\t\t\t\tif (!doc) {');
					code.push(`\t\t\t\t\terrors['${path}'] = ${_.camelCase(path + '._id')} + ' not found';`);
					code.push('\t\t\t\t} else {');
					code.push(`\t\t\t\t\t_.set(newData, '${path}._href', doc._href);`);
					code.push('\t\t\t\t}');
					code.push('\t\t} catch (e) {');
					code.push(`\t\t\terrors['${path}'] = e.message ? e.message : e;`);
					code.push('\t\t}');
					code.push('\t}');
				} else if (def.type == 'Object') {
					parseSchemaForRelation(def.definition, path);
				} else if (def.type == 'Array') {
					if (def.definition[0].properties.relatedTo || def.definition[0].type == 'User') {
						code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}.map(async (item, i) => {`);
						code.push('\t\t\ttry {');
						if (def.definition[0].properties.relatedTo)
							code.push(`\t\t\t\tconst doc = await commonUtils.getServiceDoc(req, '${def.definition[0].properties.relatedTo}', item._id, true);`);
						else
							code.push('\t\t\t\tconst doc = await commonUtils.getUserDoc(req, item._id);');
						code.push('\t\t\t\t\tif (!doc) {');
						code.push(`\t\t\t\t\t\terrors['${path}.' + i] = item._id + ' not found';`);
						code.push('\t\t\t\t\t} else {');
						code.push('\t\t\t\t\t\titem._href = doc._href;');
						code.push('\t\t\t\t\t}');
						code.push('\t\t\t} catch (e) {');
						code.push(`\t\t\t\terrors['${path}.' + i] = e.message ? e.message : e;`);
						code.push('\t\t\t}');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					} else if (def.definition[0].type == 'Object') {
						code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}.map(async (newData, i) => {`);
						parseSchemaForRelation(def.definition[0].definition, '');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					}
				}
			}
		});
	}

	function parseSchemaForExpand(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if ((def.properties.relatedTo || def.type == 'User') && def.type != 'Array') {
					code.push(`\tlet ${_.camelCase(path + '._id')} = _.get(newData, '${path}._id');`);
					code.push(`\tif (${_.camelCase(path + '._id')}) {`);
					code.push('\t\ttry {');
					code.push(`\t\t\tif (!expandForSelect || (expandForSelect && commonUtils.isExpandAllowed(req, '${path}'))) {`);
					if (def.properties.relatedTo) {
						code.push(`\t\t\t\tconst doc = await commonUtils.getServiceDoc(req, '${def.properties.relatedTo}', ${_.camelCase(path + '._id')});`);
						code.push('\t\t\t\tif (doc) {');
						code.push(`\t\t\t\t\tdoc._id = ${_.camelCase(path + '._id')};`);
						code.push(`\t\t\t\t\t_.set(newData, '${path}', doc);`);
						code.push('\t\t\t\t}');
					}
					else {
						code.push(`\t\t\tconst doc = await commonUtils.getUserDoc(req, ${_.camelCase(path + '._id')});`);
						code.push('\t\t\t\tif (!doc) {');
						code.push(`\t\t\t\t\terrors['${path}'] = ${_.camelCase(path + '._id')} + ' not found';`);
						code.push('\t\t\t\t} else {');
						code.push(`\t\t\t\t\t_.set(newData, '${path}.basicDetails', doc.basicDetails);`);
						code.push(`\t\t\t\t\t_.set(newData, '${path}.attributes', doc.attributes);`);
						code.push(`\t\t\t\t\t_.set(newData, '${path}.username', doc.username);`);
						code.push(`\t\t\t\t\t_.set(newData, '${path}._id', doc._id);`);
						code.push('\t\t\t\t}');
					}
					code.push('\t\t\t}');
					code.push('\t\t} catch (e) {');
					code.push(`\t\t\t\t\t_.set(newData, '${path}', null);`);
					code.push(`\t\t\terrors['${path}'] = e.message ? e.message : e;`);
					code.push('\t\t}');
					code.push('\t}');
				} else if (def.type == 'Object') {
					parseSchemaForExpand(def.definition, path);
				} else if (def.type == 'Array') {
					if (def.definition[0].properties.relatedTo) {
						code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}.map(async (item, i) => {`);
						code.push('\t\t\ttry {');
						code.push(`\t\t\t\tif (!expandForSelect || (expandForSelect && commonUtils.isExpandAllowed(req, '${path}'))) {`);
						code.push(`\t\t\t\t\tconst doc = await commonUtils.getServiceDoc(req, '${def.definition[0].properties.relatedTo}', item._id);`);
						code.push('\t\t\t\t\tif (doc) {');
						code.push('\t\t\t\t\t\t_.assign(item, doc);');
						code.push('\t\t\t\t\t}');
						code.push('\t\t\t\t}');
						code.push('\t\t\t} catch (e) {');
						code.push(`\t\t\t\t// errors['${path}.' + i] = e.message ? e.message : e;`);
						code.push('\t\t\t}');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					} else if (def.definition[0].type == 'Object') {
						code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}.map(async (newData, i) => {`);
						parseSchemaForExpand(def.definition[0].definition, '');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					}
				}
			}
		});
	}

	function parseSchemaForCascadeRelation(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if ((def.properties.relatedTo) && def.type != 'Array') {
					code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}');`);
					code.push(`\tif (!_.isEmpty(${_.camelCase(path)})) {`);
					code.push('\t\ttry {');
					code.push(`\t\t\tconst doc = await commonUtils.upsertDocument(req, '${def.properties.relatedTo}', ${_.camelCase(path)});`);
					code.push('\t\t\tif (doc) {');
					code.push(`\t\t\t\t_.set(newData, '${path}', doc);`);
					code.push('\t\t\t}');
					code.push('\t\t} catch (e) {');
					code.push(`\t\t\terrors['${path}'] = e.message ? e.message : e;`);
					code.push('\t\t}');
					code.push('\t}');
				} else if (def.type == 'Object') {
					parseSchemaForCascadeRelation(def.definition, path);
				} else if (def.type == 'Array') {
					if (def.definition[0].properties.relatedTo) {
						code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}.map(async (item, i) => {`);
						code.push('\t\t\ttry {');
						code.push('\t\t\t\tif (!_.isEmpty(item)) {');
						code.push(`\t\t\t\t\tconst doc = await commonUtils.upsertDocument(req, '${def.definition[0].properties.relatedTo}', item);`);
						code.push('\t\t\t\t\tif (doc) {');
						code.push('\t\t\t\t\t\t_.assign(item, doc);');
						code.push('\t\t\t\t\t}');
						code.push('\t\t\t\t}');
						code.push('\t\t\t} catch (e) {');
						code.push(`\t\t\t\t// errors['${path}.' + i] = e.message ? e.message : e;`);
						code.push('\t\t\t}');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					} else if (def.definition[0].type == 'Object') {
						code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}.map(async (newData, i) => {`);
						parseSchemaForCascadeRelation(def.definition[0].definition, '');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					}
				}
			}
		});
	}

	function createIndex(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			let path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if (def.type == 'Object' && !def.properties.geoType) {
					createIndex(def.definition, path);
				} else if (def.type == 'Array') {
					// No index for Array
				} else {
					if (def.properties.unique) {
						if (def.type === 'User' || def.properties.relatedTo) {
							path = path + '._id';
						}
						code.push(`\t\tschema.index({ '${path}': 1 }, { unique: '${path} field should be unique', sparse: true, collation: { locale: 'en', strength: 2 } });`);
					}
					if (def.properties.geoType) {
						code.push(`\t\tschema.index({ '${path}.geometry': '2dsphere' }, { name: '${path}_geoJson' });`);
					}
				}
			}
		});
	}

	function parseSchemaForUnique(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			let path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if (def.type == 'Object') {
					parseSchemaForUnique(def.definition, path);
				} else if (def.type == 'Array') {
					// code.push(`\t if((_.get(newData,'${path}')||[]).length !== (_.get(newData,'${path}')||[]).length) {`);
					// code.push(`\t\t errors.${path} = true;`);
					// code.push(`\t }`);
					// code.push(`\t for(let i=0;i<newData.${path};i++){`);
					// code.push(`\t\t const item = newData.${path}[i];`);
					// parseSchemaForUnique(def.definition, path);
					// code.push(`\t }`);
				} else {
					if (def.properties.unique) {
						if (def.type === 'User' || def.properties.relatedTo) {
							path = path + '._id';
						}
						code.push(`\tval = _.get(newData, '${path}');`);
						code.push('\tif (val) {');
						code.push(`\t\tlet query = { '${path}': val };`);
						// code.push('\t\tif(oldData) query[\'_id\'] = {\'$ne\': oldData._id};');
						code.push('\t\tconst doc = await model.find(query).collation({ locale: \'en\', strength: 2 }).lean();');
						code.push('\t\tif (doc && doc.length > 0) {');
						code.push(`\t\t\terrors['${path}'] = '${path} field should be unique';`);
						code.push('\t\t}');
						code.push('\t}');
					}
				}
			}
		});
	}

	function parseSchemaForCreateOnly(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if (def.type == 'Object') {
					parseSchemaForCreateOnly(def.definition, path);
				} else if (def.type == 'Array' && def.properties && def.properties.createOnly) {
					code.push('\t\tif (!forceRemove) {');
					code.push(`\t\t\tif (_.differenceWith((_.get(newData, '${path}')||[]), (_.get(oldData, '${path}')||[]), _.isEqual)) {`);
					// code.push(`\t\t\t\terrors['${path}'] = '${path} field cannot be updated, Violation of Create Only';`);
					// code.push(`\t\t\tdelete newData['${path}'];`);
					code.push('\t\t\t\tif(newData instanceof mongoose.Document) {');
					code.push(`\t\t\t\t\tnewData.set('${path}', _.get(oldData, '${path}'));`);
					code.push('\t\t\t\t} else {');
					code.push(`\t\t\t\t\t_.set(newData, '${path}', _.get(oldData, '${path}'));`);
					code.push('\t\t\t\t}');
					code.push('\t\t\t}');
					code.push('\t\t} else {');
					// code.push(`\t\t\tdelete newData['${path}'];`);
					code.push('\t\t\t\tif(newData instanceof mongoose.Document) {');
					code.push(`\t\t\t\t\tnewData.set('${path}', _.get(oldData, '${path}'));`);
					code.push('\t\t\t\t} else {');
					code.push(`\t\t\t\t\t_.set(newData, '${path}', _.get(oldData, '${path}'));`);
					code.push('\t\t\t\t}');
					code.push('\t\t}');
				} else {
					if (def.properties.createOnly) {
						code.push('\t\tif (!forceRemove) {');
						code.push(`\t\t\tif (_.get(newData, '${path}') !== _.get(oldData, '${path}')) {`);
						// code.push(`\t\t\t\terrors['${path}'] = '${path} field cannot be updated, Violation of Create Only';`);
						// code.push(`\t\t\tdelete newData['${path}'];`);
						code.push('\t\t\t\tif(newData instanceof mongoose.Document) {');
						code.push(`\t\t\t\t\tnewData.set('${path}', _.get(oldData, '${path}'));`);
						code.push('\t\t\t\t} else {');
						code.push(`\t\t\t\t\t_.set(newData, '${path}', _.get(oldData, '${path}'));`);
						code.push('\t\t\t\t}');
						code.push('\t\t\t}');
						code.push('\t\t} else {');
						// code.push(`\t\t\tdelete newData['${path}'];`);
						code.push('\t\t\t\tif(newData instanceof mongoose.Document) {');
						code.push(`\t\t\t\t\tnewData.set('${path}', _.get(oldData, '${path}'));`);
						code.push('\t\t\t\t} else {');
						code.push(`\t\t\t\t\t_.set(newData, '${path}', _.get(oldData, '${path}'));`);
						code.push('\t\t\t\t}');
						code.push('\t\t}');
					}
				}
			}
		});
	}

	function parseSchemaForFilter(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if (def.properties.relatedTo && def.type != 'Array') {
					code.push(`\t\t\tif (key.startsWith('${path}')) {`);
					code.push('\t\t\t\ttry {');
					code.push(`\t\t\t\t\tconst tempKey = key.split('${path}.')[1];`);
					code.push(`\t\t\t\t\tconst ids = await commonUtils.getDocumentIds(req, '${def.properties.relatedTo}', { [tempKey]: filter[key] })`);
					code.push('\t\t\t\t\tif (ids && ids.length > 0) {');
					code.push(`\t\t\t\t\t\tif (!tempFilter['${path}._id'] || !tempFilter['${path}._id']['$in']) {`);
					code.push(`\t\t\t\t\t\t\ttempFilter['${path}._id'] = { $in: ids };`);
					code.push('\t\t\t\t\t\t} else {');
					code.push(`\t\t\t\t\t\t\ttempFilter['${path}._id']['$in'] = tempFilter['${path}._id']['$in'].concat(ids);`);
					code.push('\t\t\t\t\t\t}');
					code.push('\t\t\t\t\t} else {');
					code.push('\t\t\t\t\t\ttempFilter[key] = filter[key]');
					code.push('\t\t\t\t\t}');
					code.push('\t\t\t\t\tflag = true;');
					code.push('\t\t\t\t} catch (e) {');
					code.push(`\t\t\t\t\terrors['${path}'] = e.message ? e.message : e;`);
					code.push('\t\t\t\t}');
					code.push('\t\t\t}');
				} else if (def.type == 'Object') {
					parseSchemaForFilter(def.definition, path);
				} else if (def.type == 'Array') {
					if (def.definition[0].properties.relatedTo) {
						code.push(`\t\t\tif (key.startsWith('${path}')) {`);
						code.push('\t\t\t\ttry {');
						code.push(`\t\t\t\t\tconst tempKey = key.split('${path}.')[1];`);
						code.push(`\t\t\t\t\tconst ids = await commonUtils.getDocumentIds(req, '${def.definition[0].properties.relatedTo}', { [tempKey]: filter[key] })`);
						code.push('\t\t\t\t\tif (ids && ids.length > 0) {');
						code.push(`\t\t\t\t\t\tif (!tempFilter['${path}._id'] || !tempFilter['${path}._id']['$in']) {`);
						code.push(`\t\t\t\t\t\t\ttempFilter['${path}._id'] = { $in: ids };`);
						code.push('\t\t\t\t\t\t} else {');
						code.push(`\t\t\t\t\t\t\ttempFilter['${path}._id']['$in'] = tempFilter['${path}._id']['$in'].concat(ids);`);
						code.push('\t\t\t\t\t\t}');
						code.push('\t\t\t\t\t}');
						code.push('\t\t\t\t\tflag = true;');
						code.push('\t\t\t\t} catch (e) {');
						code.push(`\t\t\t\t\terrors['${path}'] = e.message ? e.message : e;`);
						code.push('\t\t\t\t}');
						code.push('\t\t\t}');
					} else if (def.definition[0].type == 'Object') {
						parseSchemaForFilter(def.definition[0].definition, path);
					}
				}
			}
		});
	}

	function parseSchemaForWorkflowFilter(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if (def.properties.relatedTo && def.type != 'Array') {
					code.push(`\t\t\tif (key.startsWith('data.new.${path}')) {`);
					code.push('\t\t\t\ttry {');
					code.push(`\t\t\t\t\tconst tempKey = key.split('${path}.')[1];`);
					code.push(`\t\t\t\t\tconst ids = await commonUtils.getDocumentIds(req, '${def.properties.relatedTo}', { [tempKey]: filter[key] })`);
					code.push('\t\t\t\t\tif (ids && ids.length > 0) {');
					code.push(`\t\t\t\t\t\tif (!tempFilter['data.new.${path}._id'] || !tempFilter['data.new.${path}._id']['$in']) {`);
					code.push(`\t\t\t\t\t\t\ttempFilter['data.new.${path}._id'] = { $in: ids };`);
					code.push('\t\t\t\t\t\t} else {');
					code.push(`\t\t\t\t\t\t\ttempFilter['data.new.${path}._id']['$in'] = tempFilter['data.new.${path}._id']['$in'].concat(ids);`);
					code.push('\t\t\t\t\t\t}');
					code.push('\t\t\t\t\t} else {');
					code.push('\t\t\t\t\t\ttempFilter[key] = filter[key]');
					code.push('\t\t\t\t\t}');
					code.push('\t\t\t\t\tflag = true;');
					code.push('\t\t\t\t} catch (e) {');
					code.push(`\t\t\t\t\terrors['data.new.${path}'] = e.message ? e.message : e;`);
					code.push('\t\t\t\t}');
					code.push('\t\t\t}');
				} else if (def.type == 'Object') {
					parseSchemaForWorkflowFilter(def.definition, path);
				} else if (def.type == 'Array') {
					if (def.definition[0].properties.relatedTo) {
						code.push(`\t\t\tif (key.startsWith('data.new.${path}')) {`);
						code.push('\t\t\t\ttry {');
						code.push(`\t\t\t\t\tconst tempKey = key.split('${path}.')[1];`);
						code.push(`\t\t\t\t\tconst ids = await commonUtils.getDocumentIds(req, '${def.properties.relatedTo}', { [tempKey]: filter[key] })`);
						code.push('\t\t\t\t\tif (ids && ids.length > 0) {');
						code.push(`\t\t\t\t\t\tif (!tempFilter['data.new.${path}._id'] || !tempFilter['data.new.${path}._id']['$in']) {`);
						code.push(`\t\t\t\t\t\t\ttempFilter['data.new.${path}._id'] = { $in: ids };`);
						code.push('\t\t\t\t\t\t} else {');
						code.push(`\t\t\t\t\t\t\ttempFilter['data.new.${path}._id']['$in'] = tempFilter['data.new.${path}._id']['$in'].concat(ids);`);
						code.push('\t\t\t\t\t\t}');
						code.push('\t\t\t\t\t} else {');
						code.push('\t\t\t\t\t\ttempFilter[key] = filter[key]');
						code.push('\t\t\t\t\t}');
						code.push('\t\t\t\t\tflag = true;');
						code.push('\t\t\t\t} catch (e) {');
						code.push(`\t\t\t\t\terrors['data.new.${path}'] = e.message ? e.message : e;`);
						code.push('\t\t\t\t}');
						code.push('\t\t\t}');
					} else if (def.definition[0].type == 'Object') {
						parseSchemaForWorkflowFilter(def.definition[0].definition, path);
					}
				}
			}
		});
	}

	function parseSchemaForEncryption(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if (def.properties.password && def.type != 'Array') {
					if (def.properties.longText || def.properties.richText) {
						code.push(`\tlet ${_.camelCase(path)}New = _.get(newData, '${path}')`);
						code.push(`\tlet ${_.camelCase(path)}Old = _.get(oldData, '${path}')`);
						code.push(`\tif (${_.camelCase(path)}New && ${_.camelCase(path)}New != ${_.camelCase(path)}Old) {`);
						code.push('\t\ttry {');
						code.push(`\t\t\tconst doc = await commonUtils.encryptText(req, ${_.camelCase(path)}New);`);
						code.push('\t\t\tif (doc && doc.value) {');
						code.push(`\t\t\t\t_.set(newData, '${path}', doc.value);`);
						code.push('\t\t\t}');
						code.push('\t\t} catch (e) {');
						code.push(`\t\t\terrors['${path}'] = e.message ? e.message : e;`);
						code.push('\t\t}');
						code.push('\t}');
					} else if (!def.properties.fileType) {
						code.push(`\tlet ${_.camelCase(path + '.value')}New = _.get(newData, '${path}.value')`);
						code.push(`\tlet ${_.camelCase(path + '.value')}Old = _.get(oldData, '${path}.value')`);
						code.push(`\tif (${_.camelCase(path + '.value')}New && ${_.camelCase(path + '.value')}New != ${_.camelCase(path + '.value')}Old) {`);
						code.push('\t\ttry {');
						code.push(`\t\t\tconst doc = await commonUtils.encryptText(req, ${_.camelCase(path + '.value')}New);`);
						code.push('\t\t\tif (doc) {');
						code.push(`\t\t\t\t_.set(newData, '${path}', doc);`);
						code.push('\t\t\t}');
						code.push('\t\t} catch (e) {');
						code.push(`\t\t\terrors['${path}'] = e.message ? e.message : e;`);
						code.push('\t\t}');
						code.push('\t}');	
					}
				} else if (def.type == 'Object') {
					parseSchemaForEncryption(def.definition, path);
				} else if (def.type == 'Array') {
					if (def.definition[0].properties.password) {
						if (def.properties.longText || def.properties.richText) {
							code.push(`\tlet ${_.camelCase(path)}New = _.get(newData, '${path}') || [];`);
							code.push(`\tlet ${_.camelCase(path)}Old = _.get(oldData, '${path}') || [];`);
							code.push(`\tif (${_.camelCase(path)}New && Array.isArray(${_.camelCase(path)}New) && ${_.camelCase(path)}New.length > 0) {`);
							code.push(`\t\tlet promises = ${_.camelCase(path)}New.map(async (item, i) => {`);
							code.push('\t\t\ttry {');
							code.push(`\t\t\t\tif (item && !${_.camelCase(path)}Old.find(e => e == item)) {`);
							code.push('\t\t\t\t\tconst doc = await commonUtils.encryptText(req, item);');
							code.push('\t\t\t\t\tif (doc && doc.value) {');
							code.push('\t\t\t\t\t\treturn doc.value;');
							code.push('\t\t\t\t\t}');
							code.push('\t\t\t\t} else {');
							code.push('\t\t\t\t\treturn item;');
							code.push('\t\t\t\t}');
							code.push('\t\t\t} catch (e) {');
							code.push(`\t\t\t\terrors['${path}.' + i] = e.message ? e.message : e;`);
							code.push('\t\t\t}');
							code.push('\t\t});');
							code.push('\t\tpromises = await Promise.all(promises);');
							code.push(`\t\t_.set(newData, '${path}', promises);`);
							code.push('\t\tpromises = null;');
							code.push('\t}');
						} else if (!def.properties.fileType) {
							code.push(`\tlet ${_.camelCase(path)}New = _.get(newData, '${path}') || [];`);
							code.push(`\tlet ${_.camelCase(path)}Old = _.get(oldData, '${path}') || [];`);
							code.push(`\tif (${_.camelCase(path)}New && Array.isArray(${_.camelCase(path)}New) && ${_.camelCase(path)}New.length > 0) {`);
							code.push(`\t\tlet promises = ${_.camelCase(path)}New.map(async (item, i) => {`);
							code.push('\t\t\ttry {');
							code.push(`\t\t\t\tif (item && item.value && !${_.camelCase(path)}Old.find(e => e.value == item.value)) {`);
							code.push('\t\t\t\t\tconst doc = await commonUtils.encryptText(req, item.value);');
							code.push('\t\t\t\t\tif (doc) {');
							code.push('\t\t\t\t\t\t_.assign(item, doc);');
							code.push('\t\t\t\t\t}');
							code.push('\t\t\t\t}');
							code.push('\t\t\t} catch (e) {');
							code.push(`\t\t\t\terrors['${path}.' + i] = e.message ? e.message : e;`);
							code.push('\t\t\t}');
							code.push('\t\t});');
							code.push('\t\tpromises = await Promise.all(promises);');
							code.push('\t\tpromises = null;');
							code.push('\t}');
						}
					} else if (def.definition[0].type == 'Object') {
						code.push(`\tlet ${_.camelCase(path)}New = _.get(newData, '${path}') || [];`);
						code.push(`\tlet ${_.camelCase(path)}Old = _.get(oldData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)}New && Array.isArray(${_.camelCase(path)}New) && ${_.camelCase(path)}New.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}New.map(async (newData, i) => {`);
						code.push(`\t\t\tlet oldData = _.find(${_.camelCase(path)}Old, newData);`);
						parseSchemaForEncryption(def.definition[0].definition, '');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					}
				}
			}
		});
	}

	function parseSchemaForDecryption(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if (def.properties.password && def.type != 'Array') {
					if (def.properties.richText || def.properties.longText) {
						code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}')`);
						code.push(`\tif (${_.camelCase(path)}) {`);
						code.push('\t\ttry {');
						code.push(`\t\t\tconst doc = await commonUtils.decryptText(req, ${_.camelCase(path)});`);
						code.push('\t\t\tif (doc) {');
						code.push(`\t\t\t\t\t_.set(newData, '${path}', doc);`);
						code.push('\t\t\t}');
						code.push('\t\t} catch (e) {');
						code.push(`\t\t\terrors['${path}'] = e.message ? e.message : e;`);
						code.push('\t\t}');
						code.push('\t}');
					} else if (!def.properties.fileType) {
						code.push(`\tlet ${_.camelCase(path + '.value')} = _.get(newData, '${path}.value')`);
						code.push(`\tif (${_.camelCase(path + '.value')}) {`);
						code.push('\t\ttry {');
						code.push(`\t\t\tconst doc = await commonUtils.decryptText(req, ${_.camelCase(path + '.value')});`);
						code.push('\t\t\tif (doc) {');
						code.push('\t\t\t\tif(req.query && req.query.forFile) {');
						code.push(`\t\t\t\t\t_.set(newData, '${path}', doc);`);
						code.push('\t\t\t\t} else {');
						code.push(`\t\t\t\t\t_.set(newData, '${path}.value', doc);`);
						code.push('\t\t\t\t}');
						code.push('\t\t\t}');
						code.push('\t\t} catch (e) {');
						code.push(`\t\t\terrors['${path}'] = e.message ? e.message : e;`);
						code.push('\t\t}');
						code.push('\t}');
					}
				} else if (def.type == 'Object') {
					parseSchemaForDecryption(def.definition, path);
				} else if (def.type == 'Array') {
					if (def.definition[0].properties.password) {
						if (def.properties.richText || def.properties.longText) {
							code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
							code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
							code.push(`\t\tlet promises = ${_.camelCase(path)}.map(async (item, i) => {`);
							code.push('\t\t\ttry {');
							code.push('\t\t\t\tif (item) {');
							code.push('\t\t\t\t\tconst doc = await commonUtils.decryptText(req, item);');
							code.push('\t\t\t\t\tif (doc) {');
							code.push('\t\t\t\t\t\t\treturn doc;');
							code.push('\t\t\t\t\t}');
							code.push('\t\t\t\t}');
							code.push('\t\t\t} catch (e) {');
							code.push(`\t\t\t\terrors['${path}.' + i] = e.message ? e.message : e;`);
							code.push('\t\t\t}');
							code.push('\t\t});');
							code.push('\t\tpromises = await Promise.all(promises);');
							// code.push(`\t\t_.set(newData, '${path}', promises);`);
							code.push('\t\tpromises = null;');
							code.push('\t}');
						} else if (!def.properties.fileType) {
							code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
							code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
							code.push(`\t\tlet promises = ${_.camelCase(path)}.map(async (item, i) => {`);
							code.push('\t\t\ttry {');
							code.push('\t\t\t\tif (item && item.value) {');
							code.push('\t\t\t\t\tconst doc = await commonUtils.decryptText(req, item.value);');
							code.push('\t\t\t\t\tif (doc) {');
							code.push('\t\t\t\t\t\tif (req.query && req.query.forFile) {');
							code.push('\t\t\t\t\t\t\titem = doc;');
							code.push('\t\t\t\t\t\t} else {');
							code.push('\t\t\t\t\t\t\titem.value = doc;');
							code.push('\t\t\t\t\t\t}');
							code.push('\t\t\t\t\t}');
							code.push('\t\t\t\t}');
							code.push('\t\t\t} catch (e) {');
							code.push(`\t\t\t\terrors['${path}.' + i] = e.message ? e.message : e;`);
							code.push('\t\t\t}');
							code.push('\t\t});');
							code.push('\t\tpromises = await Promise.all(promises);');
							code.push('\t\tpromises = null;');
							code.push('\t}');
						}
					} else if (def.definition[0].type == 'Object') {
						code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}.map(async (item, i) => {`);
						parseSchemaForDecryption(def.definition[0].definition, '');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					}
				}
			}
		});
	}

	function parseSchemaForBoolean(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def) {
				if (def.type == 'Boolean') {
					code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}')`);
					code.push('\ttry {');
					code.push(`\t\tif (typeof ${_.camelCase(path)} == 'number' || typeof ${_.camelCase(path)} == 'boolean') {`);
					code.push(`\t\t\t${_.camelCase(path)} = ${_.camelCase(path)}.toString();`);
					code.push('\t\t}');
					code.push(`\t\tif (typeof ${_.camelCase(path)} == 'string') {`);
					code.push(`\t\t\t${_.camelCase(path)} = ${_.camelCase(path)}.toLowerCase();`);
					code.push(`\t\t\tif (_.indexOf(trueBooleanValues, ${_.camelCase(path)}) > -1) {`);
					code.push(`\t\t\t\t_.set(newData, '${path}', true);`);
					code.push(`\t\t\t} else if (_.indexOf(falseBooleanValues, ${_.camelCase(path)}) > -1) {`);
					code.push(`\t\t\t\t_.set(newData, '${path}', false);`);
					code.push('\t\t\t} else {');
					code.push('\t\t\t\tthrow new Error(\'Invalid Boolean Value\');');
					code.push('\t\t\t}');
					code.push('\t\t}');
					code.push('\t} catch (e) {');
					code.push(`\t\terrors['${path}'] = e.message ? e.message : e;`);
					code.push('\t}');
					code.push(`\t_.set(newData, '${path}', ${_.camelCase(path)});`);
				} else if (def.type == 'Object') {
					parseSchemaForBoolean(def.definition, path);
				} else if (def.type == 'Array') {
					if (def.definition[0].type == 'Boolean') {
						code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
						code.push(`\t\t${_.camelCase(path)} = ${_.camelCase(path)}.map((item, i) => {`);
						code.push('\t\t\ttry {');
						code.push('\t\t\t\tif (typeof item == \'number\' || typeof item == \'boolean\') {');
						code.push('\t\t\t\t\titem = item.toString();');
						code.push('\t\t\t\t}');
						code.push('\t\t\t\tif (typeof item == \'string\' && _.indexOf(trueBooleanValues, item.toLowerCase()) > -1) {');
						code.push('\t\t\t\t\treturn true;');
						code.push('\t\t\t\t} else if (typeof item == \'string\' && _.indexOf(falseBooleanValues, item.toLowerCase()) > -1){');
						code.push('\t\t\t\t\treturn false;');
						code.push('\t\t\t\t} else {');
						code.push('\t\t\t\t\tthrow new Error(\'Invalid Boolean Value\');');
						code.push('\t\t\t\t}');
						code.push('\t\t\t} catch (e) {');
						code.push(`\t\t\t\terrors['${path}.' + i] = e.message ? e.message : e;`);
						code.push('\t\t\t\treturn false;');
						code.push('\t\t\t}');
						code.push('\t\t});');
						code.push('\t}');
						code.push(`\t_.set(newData, '${path}', ${_.camelCase(path)});`);
					} else if (def.definition[0].type == 'Object') {
						code.push(`\tlet ${_.camelCase(path)} = _.get(newData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)} && Array.isArray(${_.camelCase(path)}) && ${_.camelCase(path)}.length > 0) {`);
						code.push(`\t\t${_.camelCase(path)}.forEach((newData, i) => {`);
						parseSchemaForBoolean(def.definition[0].definition, '');
						code.push('\t\t});');
						code.push('\t}');
						code.push(`\t_.set(newData, '${path}', ${_.camelCase(path)});`);
					}
				}
			}
		});
	}

	function parseSchemaForGeojson(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if (def.type == 'Geojson' || def.properties.geoType) {
					code.push(`\tlet ${_.camelCase(path)}New = _.get(newData, '${path}')`);
					code.push(`\tlet ${_.camelCase(path)}Old = _.get(oldData, '${path}')`);
					code.push(`\tif (${_.camelCase(path)}New && !_.isEqual(${_.camelCase(path)}New,${_.camelCase(path)}Old)) {`);
					code.push('\t\ttry {');
					code.push(`\t\t\tconst doc = await commonUtils.getGeoDetails(req, '${_.camelCase(path)}', ${_.camelCase(path)}New);`);
					code.push('\t\t\tif (doc) {');
					code.push(`\t\t\t\t_.set(newData, '${path}', doc.geoObj);`);
					code.push('\t\t\t}');
					code.push('\t\t} catch (e) {');
					code.push(`\t\t\t// errors['${path}'] = e.message ? e.message : e;`);
					code.push('\t\t}');
					code.push('\t}');
				} else if (def.type == 'Object') {
					parseSchemaForGeojson(def.definition, path);
				} else if (def.type == 'Array') {
					if (def.definition[0].type == 'Geojson' || def.definition[0].properties.geoType) {
						code.push(`\tlet ${_.camelCase(path)}New = _.get(newData, '${path}') || [];`);
						code.push(`\tlet ${_.camelCase(path)}Old = _.get(oldData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)}New && Array.isArray(${_.camelCase(path)}New) && ${_.camelCase(path)}New.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}New.map(async (item, i) => {`);
						code.push(`\t\t\tif (!_.find(${_.camelCase(path)}Old, item)) {`);
						code.push('\t\t\t\ttry {');
						code.push(`\t\t\t\t\tconst doc = await commonUtils.getGeoDetails(req, '${_.camelCase(path)}', item);`);
						code.push('\t\t\t\t\tif (doc) {');
						code.push('\t\t\t\t\t\t_.assign(item, doc.geoObj);');
						code.push('\t\t\t\t\t}');
						code.push('\t\t\t\t} catch (e) {');
						code.push(`\t\t\t\t\t// errors['${path}.' + i] = e.message ? e.message : e;`);
						code.push('\t\t\t\t}');
						code.push('\t\t\t}');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					} else if (def.definition[0].type == 'Object') {
						code.push(`\tlet ${_.camelCase(path)}New = _.get(newData, '${path}') || [];`);
						code.push(`\tlet ${_.camelCase(path)}Old = _.get(oldData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)}New && Array.isArray(${_.camelCase(path)}New) && ${_.camelCase(path)}New.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}New.map(async (newData, i) => {`);
						code.push(`\t\t\tlet oldData = _.find(${_.camelCase(path)}Old, newData);`);
						parseSchemaForGeojson(def.definition[0].definition, '');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					}
				}
			}
		});
	}

	function parseSchemaForDateFields(schema, parentKey) {
		schema.forEach(def => {
			let key = def.key;
			const path = parentKey ? parentKey + '.' + key : key;
			if (key != '_id' && def.properties) {
				if (def.type == 'Object' && def['properties']['dateType']) {
					code.push(`\tlet ${_.camelCase(path)}DefaultTimezone = ` + (def['properties']['defaultTimezone'] ? `'${def['properties']['defaultTimezone']}'` : undefined) + ';');
					code.push(`\tlet ${_.camelCase(path)}SupportedTimezones = ${def['properties']['supportedTimezones'] ? JSON.stringify(def['properties']['supportedTimezones']) : '[]'};`);
					code.push(`\tlet ${_.camelCase(path)}New = _.get(newData, '${path}')`);
					code.push(`\tlet ${_.camelCase(path)}Old = _.get(oldData, '${path}')`);
					code.push(`\tif (typeof ${_.camelCase(path)}New === 'string') {`);
					code.push(`\t\t${_.camelCase(path)}New = {`);
					code.push(`\t\t\trawData: ${_.camelCase(path)}New`);
					code.push('\t\t};');
					code.push('\t}');
					code.push(`\tif (typeof ${_.camelCase(path)}Old === 'string') {`);
					code.push(`\t\t${_.camelCase(path)}Old = {`);
					code.push(`\t\t\trawData: ${_.camelCase(path)}Old`);
					code.push('\t\t};');
					code.push('\t}');
					code.push(`\tif (!_.isEqual(${_.camelCase(path)}New, ${_.camelCase(path)}Old)) {`);
					code.push('\t\ttry {');
					code.push(`\t\t\t${_.camelCase(path)}New = commonUtils.getFormattedDate(txnId, ${_.camelCase(path)}New, ${_.camelCase(path)}DefaultTimezone, ${_.camelCase(path)}SupportedTimezones);`);
					// _.set(newData, 'time', timeNew);
					code.push(`\t\t\t_.set(newData, '${path}', ${_.camelCase(path)}New);`);
					code.push('\t\t} catch (e) {');
					code.push(`\t\t\terrors['${path}'] = e.message ? e.message : e;`);
					code.push('\t\t}');
					code.push('\t}');
				} else if (def.type == 'Object') {
					parseSchemaForDateFields(def.definition, path);
				} else if (def.type == 'Array') {
					if (def.definition[0]['properties'] && def.definition[0]['properties']['dateType']) {
						code.push(`\tlet ${_.camelCase(path)}DefaultTimezone = ` + (def.definition[0]['properties']['defaultTimezone'] ? `'${def.definition[0]['properties']['defaultTimezone']}'` : undefined) + ';');
						code.push(`\tlet ${_.camelCase(path)}SupportedTimezones = ${def.definition[0]['properties']['supportedTimezones'] ? JSON.stringify(def.definition[0]['properties']['supportedTimezones']) : '[]'};`);
						code.push(`\tlet ${_.camelCase(path)}New = _.get(newData, '${path}') || [];`);
						code.push(`\tlet ${_.camelCase(path)}Old = _.get(oldData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)}New && Array.isArray(${_.camelCase(path)}New) && ${_.camelCase(path)}New.length > 0 && !_.isEqual(${_.camelCase(path)}New, ${_.camelCase(path)}Old)) {`);
						code.push(`\t\t${_.camelCase(path)}New = ${_.camelCase(path)}New.map((item, i) => {`);
						code.push('\t\t\ttry {');
						code.push(`\t\t\t\treturn commonUtils.getFormattedDate(txnId, item, ${_.camelCase(path)}DefaultTimezone, ${_.camelCase(path)}SupportedTimezones);`);
						code.push('\t\t\t} catch (e) {');
						code.push(`\t\t\t\terrors['${path}.' + i] = e.message ? e.message : e;`);
						code.push('\t\t\t}');
						code.push('\t\t});');
						code.push(`\t\t_.set(newData, '${path}', ${_.camelCase(path)}New);`);
						code.push('\t}');
					} else if (def.definition[0]['type'] == 'Object') {
						code.push(`\tlet ${_.camelCase(path)}New = _.get(newData, '${path}') || [];`);
						code.push(`\tlet ${_.camelCase(path)}Old = _.get(oldData, '${path}') || [];`);
						code.push(`\tif (${_.camelCase(path)}New && Array.isArray(${_.camelCase(path)}New) && ${_.camelCase(path)}New.length > 0) {`);
						code.push(`\t\tlet promises = ${_.camelCase(path)}New.map(async (newData, i) => {`);
						code.push(`\t\t\tlet oldData = _.find(${_.camelCase(path)}Old, newData);`);
						parseSchemaForDateFields(def.definition[0].definition, '');
						code.push('\t\t});');
						code.push('\t\tpromises = await Promise.all(promises);');
						code.push('\t\tpromises = null;');
						code.push('\t}');
					}
				}
			}
		});
	}





	function parseFieldsForPermisison(fields, parentKey) {
		Object.keys(fields).forEach(key => {
			const dataKey = parentKey ? parentKey + '.' + key : key;
			const permObj = fields[key]._p;
			if (permObj) {
				const permIds = Object.keys(permObj).map(e => ({ id: e, val: permObj[e] })).filter(e => e.val == 'R').map(e => e.id);
				code.push(`\tif (_.intersection(${JSON.stringify(permIds)}, permissions).length == 0) {`);
				code.push(`\t\t_.unset(data, '${dataKey}');`);
				code.push('\t}');
			} else {
				parseFieldsForPermisison(fields[key], key);
			}
		});
	}

	function parseRolesForPermisison(roles, workflowConfig) {
		const methodIdMap = {};
		roles.forEach(e => {
			return e.operations.forEach(o => {
				if (!methodIdMap[o.method]) {
					methodIdMap[o.method] = [];
				}
				methodIdMap[o.method].push(e.id);
			});
		});
		Object.keys(methodIdMap).forEach(method => {
			code.push(`function hasPermissionFor${method}(req, permissions) {`);
			// //Super Admin Code
			// code.push('\tif (req.user.isSuperAdmin) {');
			// code.push('\t\treturn true;');
			// code.push('\t}');

			//App Admin Code
			code.push('\tif (req.user.apps && req.user.apps.indexOf(config.app) > -1) {');
			code.push('\t\treturn true;');
			code.push('\t}');
			//Data Service Admin Code
			code.push(`\tif (_.intersection(['ADMIN_${config._id}'], permissions).length > 0) {`);
			code.push('\t\treturn true;');
			code.push('\t}');
			//Normal User Code
			code.push(`\tif (_.intersection(${JSON.stringify(methodIdMap[method])}, permissions).length > 0) {`);
			code.push('\t\treturn true;');
			code.push('\t}');

			//If GET Method check for review Permissions as Well
			if (method === 'GET' && workflowConfig && workflowConfig.enabled && workflowConfig.makerCheckers && workflowConfig.makerCheckers[0]) {
				const steps = (workflowConfig.makerCheckers[0].steps || []);
				const wfPermissions = steps.map(e => e.id);
				code.push(`\tif (_.intersection(${JSON.stringify(wfPermissions)}, permissions).length > 0) {`);
				code.push('\t\treturn true;');
				code.push('\t}');
			}

			code.push('\treturn false;');
			code.push('}');
			code.push(`module.exports.hasPermissionFor${method} = hasPermissionFor${method};`);
		});
	}

	function parseMultiLevelWF(workflow) {
		if (!workflow) {
			return;
		}
		if (Array.isArray(workflow) && !workflow[0]) {
			return;
		}
		let steps;
		if (Array.isArray(workflow)) {
			steps = workflow[0].steps;
		} else {
			steps = workflow.steps;
		}
		code.push('const hasWFPermissionFor = {};');
		for (let index = 0; index < steps.length; index++) {
			const step = steps[index];
			// const methodName = _.camelCase(step.name);
			const methodName = step.name.trim();
			code.push(`hasWFPermissionFor['${methodName}'] = function(req, permissions) {`);
			//Super Admin Code
			// code.push('\tif (req.user.isSuperAdmin) {');
			// code.push('\t\treturn true;');
			// code.push('\t}');

			//Data Service Admin Code
			code.push(`\tif (_.intersection(['ADMIN_${config._id}'], permissions).length > 0) {`);
			code.push('\t\treturn true;');
			code.push('\t}');
			//Normal User Code
			code.push(`\tif (_.intersection(['${step.id}'], permissions).length > 0) {`);
			code.push('\t\treturn true;');
			code.push('\t}');
			code.push('\treturn false;');
			code.push('}');
			code.push('module.exports.hasWFPermissionFor = hasWFPermissionFor;');
		}


		code.push('function getNextWFStep(req, currentStep) {');
		for (let index = 0; index < steps.length - 1; index++) {
			const currStep = steps[index];
			const nextStep = steps[index + 1];
			code.push(`\tif ('${currStep.name}' === currentStep) {`);
			code.push(`\t\treturn '${nextStep.name}';`);
			code.push('\t}');
		}
		code.push('\treturn null;');
		code.push('}');
		code.push('module.exports.getNextWFStep = getNextWFStep;');

	}
}


module.exports.genrateCode = genrateCode;