const mongoose = require('mongoose');
const utils = require('@appveen/utils');
const _ = require('lodash');

const config = require('../../config');
// const queue = require('../../queue');
const definition = require('../helpers/service.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');
const hooksUtils = require('../utils/hooks.utils');
const specialFields = require('../utils/special-fields.utils');
const { removeNullForUniqueAttribute } = require('../utils/common.utils');


const logger = global.logger;
let softDeletedModel;
if (!config.permanentDelete) softDeletedModel = mongoose.model(config.serviceId + '.deleted');

const schema = new mongoose.Schema(definition, {
	usePushEach: true
});

schema.plugin(mongooseUtils.metadataPlugin());
schema.plugin(specialFields.mongooseUniquePlugin());

schema.pre('validate', async function (next) {
	const newDoc = this;
	const oldDoc = this._oldDoc;
	const req = this._req;
	try {
		const errors = await specialFields.fixBoolean(req, newDoc, oldDoc);
		if (errors) {
			next(errors);
		} else {
			next();
		}
	} catch (e) {
		next(e);
	}
});

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

schema.pre('validate', function (next) {
	let self = this;
	specialFields.uniqueFields.forEach(_k=> removeNullForUniqueAttribute(self, _k.key));
	next();
});

schema.pre('save', function (next) {
	let self = this;
	specialFields.uniqueFields.forEach(_k=> removeNullForUniqueAttribute(self, _k.key));
	next();
});

schema.pre('save', utils.counter.getIdGenerator(config.ID_PREFIX, config.serviceCollection, config.ID_SUFFIX, config.ID_PADDING, config.ID_COUNTER));

schema.pre('save', async function (next) {
	const req = this._req;
	try {
		let options = {
			operation: this.isNew ? 'POST' : 'PUT',
			simulate: false,
			source: 'presave'
		};
		if (this._isFromWorkflow) {
			await specialFields.decryptSecureFields(req, this, null);
		}
		const data = await hooksUtils.callAllPreHooks(req, this, options);
		logger.trace(`[${req.headers[global.txnIdHeader]}] Prehook data :: ${JSON.stringify(data)}`);
		delete data._metadata;
		_.assign(this, data);
		next();
	} catch (e) {
		next(e);
	}
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

// Commenting as unique calidation is handled at post save level
// schema.pre('save', async function (next) {
//     const newDoc = this;
//     const oldDoc = this._oldDoc;
//     const req = this._req;
//     try {
//         const errors = await specialFields.validateUnique(req, newDoc, oldDoc);
//         if (errors) {
//             next(errors);
//         } else {
//             next();
//         }
//     } catch (e) {
//         next(e);
//     }
// });

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

schema.pre('save', function (next) {
	let doc = this.toObject();
	Object.keys(doc).forEach(el => this.markModified(el));
	next();
});


schema.post('save', function (doc, next) {
	const req = doc._req;
	const newData = doc.toObject();
	const oldData = doc._oldData ? JSON.parse(JSON.stringify(doc._oldData)) : null;
	const webHookData = {};
	webHookData._id = newData._id;
	webHookData.user = req.headers[global.userHeader];
	webHookData.txnId = req.headers[global.txnIdHeader] || req.headers['txnid'];
	webHookData.new = newData;
	webHookData.old = oldData;
	next();
	hooksUtils.prepPostHooks(webHookData);
	// queue.sendToQueue(webHookData);
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
			// client.publish('auditQueue', JSON.stringify(auditData))
			hooksUtils.insertAuditLog(webHookData.txnId, auditData);
		}
	}
});

schema.post('save', function (error, doc, next) {
	if (!error) return next();
	if (error.code == 11000) {
		if (error.errmsg) {
			if (error.errmsg.indexOf('_id') > -1 && error.errmsg.indexOf('._id') === -1) {
				next(new Error(`ID ${doc._id} already exists.`));
			} else {
				var uniqueAttributeFailed = error.errmsg.substring(
					error.errmsg.lastIndexOf('index:') + 7,
					error.errmsg.lastIndexOf('_1')
				);
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