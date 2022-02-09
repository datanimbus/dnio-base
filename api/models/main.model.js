const mongoose = require('mongoose');
const utils = require('@appveen/utils');
const log4js = require('log4js');
const _ = require('lodash');

const config = require('../../config');
const definition = require('../helpers/service.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');
const hooksUtils = require('../utils/hooks.utils');
const specialFields = require('../utils/special-fields.utils');
const { removeNullForUniqueAttribute } = require('../utils/common.utils');
const serviceData = require('../../service.json');
const helperUtil = require('../utils/common.utils');
const workflowUtils = require('../utils/workflow.utils');

const dataStackNS = process.env.DATA_STACK_NAMESPACE;
const logger = log4js.getLogger(global.loggerName);

let softDeletedModel;
if (!config.permanentDelete) softDeletedModel = mongoose.model(config.serviceId + '.deleted');

let serviceId = process.env.SERVICE_ID || 'SRVC2006';
let schema;

if (serviceData.schemaFree) {
	schema = new mongoose.Schema({ _id: "String" }, {
		strict: false,
		usePushEach: true
	});
} else {
	schema = new mongoose.Schema(definition, {
		usePushEach: true
	});

	schema.plugin(specialFields.mongooseUniquePlugin());

	schema.pre('validate', function (next) {
		let self = this;
		specialFields.uniqueFields.forEach(_k => removeNullForUniqueAttribute(self, _k.key));
		next();
	});
	
	schema.pre('save', function (next) {
		let self = this;
		specialFields.uniqueFields.forEach(_k => removeNullForUniqueAttribute(self, _k.key));
		next();
	});
	
	schema.pre('save', function (next, req) {
		let self = this;
		if (self._metadata.version) {
			self._metadata.version.release = process.env.RELEASE;
		}
		const headers = {};
		const headersLen = this._req.rawHeaders.length;
		for (let index = 0; index < headersLen; index += 2) {
			headers[this._req.rawHeaders[index]] = this._req.rawHeaders[index + 1];
		}
		req.headers = headers;
		this._req.headers = headers;
		next();
	});

	schema.pre('save', function (next) {
		const newDoc = this;
		const oldDoc = this._oldDoc;
		const req = this._req;
		const errors = specialFields.validateCreateOnly(req, newDoc, oldDoc);
		if (errors) {
			next(errors);
		} else {
			next();
		}
	});
	
	schema.pre('save', async function (next) {
		const newDoc = this;
		const oldDoc = this._oldDoc;
		const req = this._req;
		try {
			const errors = await specialFields.validateRelation(req, newDoc, oldDoc);
			if (errors) {
				next(errors);
			} else {
				next();
			}
		} catch (e) {
			next(e);
		}
	});
	
	schema.pre('save', async function (next) {
		const newDoc = this;
		const oldDoc = this._oldDoc;
		const req = this._req;
		try {
			const errors = await specialFields.encryptSecureFields(req, newDoc, oldDoc);
			if (errors) {
				next(errors);
			} else {
				next();
			}
		} catch (e) {
			next(e);
		}
	});
	
	schema.pre('save', async function (next) {
		const newDoc = this;
		const oldDoc = this._oldDoc;
		const req = this._req;
		try {
			const errors = await specialFields.enrichGeojson(req, newDoc, oldDoc);
			if (errors) {
				next(errors);
			} else {
				next();
			}
		} catch (e) {
			next(e);
		}
	});
	
	schema.pre('save', async function (next) {
		const newDoc = this;
		const oldDoc = this._oldDoc;
		const req = this._req;
		try {
			const errors = await specialFields.validateDateFields(req, newDoc, oldDoc);
			if (errors) {
				let txnId = req.headers['txnid'];
				logger.error(`[${txnId}] Error in validation date fields :: `, errors);
				next(errors);
			} else {
				next();
			}
		} catch (e) {
			next(e);
		}
	});
	
	schema.pre('save', async function (next) {
		const newDoc = this;
		const oldDoc = this._oldDoc;
		const req = this._req;
		try {
			if (req.query) {
				const errors = await specialFields.cascadeRelation(req, newDoc, oldDoc);
				if (errors) {
					let txnId = req.headers['txnid'];
					logger.error(`[${txnId}] Error in cascading relations :: `, errors);
					next(errors);
				} else {
					next();
				}
			} else {
				next();
			}
		} catch (e) {
			next(e);
		}
	});

	schema.post('save', function (error, doc, next) {
		if (!error) return next();
		if (error.code == 11000) {
			if (error.errmsg) {
				if (!error.errmsg.match(/(.*)index:(.*)_1 collation(.*)/g)) {
					next(new Error(`ID ${doc._id} already exists.`));
				} else {
					var uniqueAttributeFailed = error.errmsg.replace(/(.*)index: (.*)_1 collation(.*)/, '$2').split('\n')[0];
					if (uniqueAttributeFailed.endsWith('._id'))
						uniqueAttributeFailed = uniqueAttributeFailed.slice(0, -4);
					if (uniqueAttributeFailed.endsWith('.checksum') && specialFields.secureFields.includes(uniqueAttributeFailed.slice(0, -9)))
						uniqueAttributeFailed = uniqueAttributeFailed.slice(0, -9);
					next(new Error('Unique check validation failed for ' + uniqueAttributeFailed));
				}
			} else {
				next(new Error('Unique check validation failed'));
			}
		} else {
			next();
		}
	});
}

schema.plugin(mongooseUtils.metadataPlugin());

schema.pre('save', utils.counter.getIdGenerator(config.ID_PREFIX, config.serviceCollection, config.ID_SUFFIX, config.ID_PADDING, config.ID_COUNTER));

schema.pre('validate', async function (next) {
	const self = this;
	if (!config.permanentDelete && self.isnew && self._id) {
		softDeletedModel.findById(self._id).then(doc => {
			if (doc)
				next(new Error('ID ' + self._id + 'already exists in deleted records.'));
			else
				next();
		}).catch(e => {
			logger.error('Error in validating ID ', e);
			next(e);
		});
	} else {
		next();
	}
});

schema.pre('save', async function (next) {
	const req = this._req;
	try {
		let options = {
			operation: this.isNew ? 'POST' : 'PUT',
			simulate: false,
			source: 'presave'
		};
		const data = await hooksUtils.callAllPreHooks(req, this, options);
		logger.trace(`[${req.headers[global.txnIdHeader]}] Prehook data :: ${JSON.stringify(data)}`);
		delete data._metadata;
		if (serviceData.schemaFree) {
			Object.keys(data).forEach(key => {
				if(this.get(key) != data[key])
					this.set(key, data[key]);
			});
		} else {
			_.assign(this, data);
		}
		next();
	} catch (e) {
		next(e);
	}
});

schema.pre('save', function (next) {
	const newDoc = this;
	const oldDoc = this._oldDoc;
	const req = this._req;

	if (!serviceData.schemaFree && serviceData.stateModel && serviceData.stateModel.enabled && !oldDoc &&
		!serviceData.stateModel.initialStates.includes(_.get(newDoc, serviceData.stateModel.attribute)) &&
		!workflowUtils.hasAdminAccess(req, req.user.appPermissions)) {
		return next(new Error('Record is not in initial state.'));
	}

	if (!serviceData.schemaFree && serviceData.stateModel && serviceData.stateModel.enabled && oldDoc
		&& !serviceData.stateModel.states[_.get(oldDoc, serviceData.stateModel.attribute)].includes(_.get(newDoc, serviceData.stateModel.attribute))
		&& _.get(oldDoc, serviceData.stateModel.attribute) !== _.get(newDoc, serviceData.stateModel.attribute)
		&& !workflowUtils.hasAdminAccess(req, req.user.appPermissions)) {
		return next(new Error('State transition is not allowed'));
	}
	next();

});

schema.pre('save', function (next) {
	let doc = this.toObject();
	Object.keys(doc).forEach(el => this.markModified(el));
	next();
});

schema.post('save', function (doc, next) {
	const req = doc._req;
	const newData = doc.toObject();
	const oldData = doc._oldDoc ? JSON.parse(JSON.stringify(doc._oldDoc)) : null;
	const webHookData = {};
	webHookData._id = newData._id;
	webHookData.user = req.headers[global.userHeader];
	webHookData.txnId = req.headers[global.txnIdHeader] || req.headers['txnid'];
	webHookData.new = JSON.parse(JSON.stringify(newData));
	webHookData.old = JSON.parse(JSON.stringify(oldData));
	next();
	hooksUtils.prepPostHooks(JSON.parse(JSON.stringify(webHookData)));
	if (!config.disableAudits) {
		let auditData = {};
		auditData.versionValue = '-1';
		auditData.user = webHookData.user;
		auditData.txnId = webHookData.txnId;
		auditData.timeStamp = new Date();
		auditData.data = {};
		auditData.data.old = {};
		auditData.data.new = {};
		auditData._metadata = {};
		auditData.colName = `${config.app}.${config.serviceCollection}.audit`;
		auditData._metadata.lastUpdated = new Date();
		auditData._metadata.createdAt = new Date();
		auditData._metadata.deleted = false;
		auditData.data._id = webHookData.new._id;
		auditData.data._version = webHookData.new._metadata.version.document;
		getDiff(webHookData.old, webHookData.new, auditData.data.old, auditData.data.new);
		let oldLastUpdated = auditData.data.old && auditData.data.old._metadata ? auditData.data.old._metadata.lastUpdated : null;
		let newLastUpdated = auditData.data.new && auditData.data.new._metadata ? auditData.data.new._metadata.lastUpdated : null;
		if (oldLastUpdated) delete auditData.data.old._metadata.lastUpdated;
		if (newLastUpdated) delete auditData.data.new._metadata.lastUpdated;
		if (!_.isEqual(auditData.data.old, auditData.data.new)) {
			if (oldLastUpdated) auditData.data.old._metadata.lastUpdated = oldLastUpdated;
			if (newLastUpdated) auditData.data.new._metadata.lastUpdated = newLastUpdated;
			hooksUtils.insertAuditLog(webHookData.txnId, auditData);
		}
	}
});

schema.pre('remove', function (next) {
	let txnId = this._req.get('txnId');
 	logger.info(`[${txnId}] Pre remove hook - checking relations ${this._id}`);
	let promiseArr = [];
	let self = this;
	let inService = [];
	helperUtil.getServiceDetail(serviceId, this._req)
		.then((serviceDetail) => {
			logger.trace(`[${txnId}] Service details ${serviceId} :: ${JSON.stringify(serviceDetail)}`);

			let incoming = serviceDetail.relatedSchemas.incoming;
			logger.trace(`[${txnId}] Incoming relations ${JSON.stringify(incoming)}`);
			
			if (incoming && incoming.length !== 0) {
				inService = incoming.map(obj => {
					obj.uri = obj.uri.replace('{{id}}', self._id);
					return obj;
				});
			}
		})
		.then(() => {
			logger.trace(`[${txnId}] Incoming Services ${JSON.stringify(inService)}`);
			inService.forEach(obj => {
				if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
					let split = obj.uri.split('/');
					obj.host = split[2].split('?')[0].toLowerCase() + '.' + dataStackNS + '-' + split[1].toLowerCase().replace(/ /g, '');
					obj.port = 80;
				} else {
					obj.host = 'localhost';
				}
				promiseArr.push(getRelationCheckObj(obj, this._req));
			});
			return Promise.all(promiseArr);
		})
		.then((_relObj) => {
			if (_relObj && _relObj.length === inService.length) {
				_relObj.forEach(_o => {
					if (_o.documents.length !== 0 && _o.isRequired) {
						next(new Error('Document still in use. Cannot Delete'));
					}
				});
			} else {
				next(new Error('Cannot complete request'));
			}
			logger.trace(`[${txnId}] Relations :: ${JSON.stringify(_relObj)}`);
			self._relObj = _relObj;
			next();
		})
		.catch((err) => {
			next(err);
		});
});

schema.post('remove', function (doc) {
	let txnId = this._req.get('txnId');
 	logger.info(`[${txnId}] Post remove hook - updating relations ${this._id}`);

	let updateList = [];
	doc._relObj.forEach(_o => {
		_o.documents.forEach(_oDoc => {
			let filter = _o.uri.split('?')[1].split('filter=')[1].split('&')[0];
			filter = JSON.parse(filter);
			let uriSplit = _o.uri.split('/');
			let _service = { port: _o.port, uri: _o.uri.split('?')[0] + '/' + _oDoc._id };
			if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
				_service.port = 80;
				_service.host = uriSplit[2].split('?')[0].toLowerCase() + '.' + dataStackNS + '-' + uriSplit[1].toLowerCase().replace(/ /g, '');
			} else {
				_service.host = 'localhost';
			}
			let ulObj = updateList.find(_ul => _ul.serviceId === _o.service && _ul.doc._id === _oDoc._id);
			if (ulObj) {
				ulObj.doc = helperUtil.generateDocumentObj(filter, ulObj.doc, doc._id);
			} else {
				updateList.push({ serviceId: _o.service, doc: helperUtil.generateDocumentObj(filter, _oDoc, doc._id), _service: _service });
			}
		});
	});
	logger.debug(JSON.stringify({ updateList }));
	updateList.forEach(ulObj => {
		helperUtil.crudDocuments(ulObj._service, 'PUT', ulObj.doc, null, doc._req);
	});
});

mongoose.model(config.serviceId, schema, config.serviceCollection);

function getDiff(a, b, oldData, newData) {
	if (a === null || b === null) {
		Object.assign(oldData, a);
		Object.assign(newData, b);
	}
	else if (typeof a == 'object' && typeof b == 'object') {
		Object.keys(a).forEach(_ka => {
			if (typeof b[_ka] == 'undefined') {
				oldData[_ka] = a[_ka];
				newData[_ka] = null;
			} else if (isValue(a[_ka]) || isArray(a[_ka])) {
				if (!isEqual(a[_ka], b[_ka])) {
					oldData[_ka] = a[_ka];
					newData[_ka] = b[_ka];
				}
				delete b[_ka];
			} else {
				oldData[_ka] = {};
				newData[_ka] = {};
				getDiff(a[_ka], b[_ka], oldData[_ka], newData[_ka]);
				if (_.isEmpty(oldData[_ka])) delete oldData[_ka];
				if (_.isEmpty(newData[_ka])) delete newData[_ka];
				delete b[_ka];
			}
		});
		Object.keys(b).forEach(_kb => {
			oldData[_kb] = null;
			newData[_kb] = b[_kb];
		});
	}
}

function isValue(a) {
	return a == null || !(typeof a == 'object');
}

function isArray(a) {
	return Array.isArray(a);
}

function isEqual(a, b) {
	return (_.isEqual(a, b));
}

function getRelationCheckObj(obj, req) {
	return helperUtil.crudDocuments(obj, 'GET', null, null, req)
		.then(docs => {
			let retObj = JSON.parse(JSON.stringify(obj));
			retObj.documents = docs;
			return retObj;
		});
}
