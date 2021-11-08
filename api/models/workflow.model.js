const mongoose = require('mongoose');
const utils = require('@appveen/utils');
const _ = require('lodash');
// const dataStackUtils = require('@appveen/data.stack-utils');

const config = require('../../config');
const definition = require('../helpers/workflow.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');
const hooksUtils = require('../utils/hooks.utils');
const specialFields = require('../utils/special-fields.utils');
const serviceData = require('../../service.json');

// const client = queue.client;
const logger = global.logger;
// const authorDB = global.authorDB;
let model;
// let hookModel;

const statusMap = {
	Pending: 'submit',
	Approved: 'approve',
	Rejected: 'reject',
	Discarded: 'discard',
	Rework: 'rework'
};

const schema = new mongoose.Schema(definition, {
	usePushEach: true
});

// const hookSchema = new mongoose.Schema({}, {
// 	usePushEach: true,
// 	strict: false,
// });


// hookSchema.plugin(mongooseUtils.metadataPlugin());

schema.plugin(mongooseUtils.metadataPlugin());
schema.index({ operation: 1, status: 1, documentId: 1, requestedBy: 1 });

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

schema.pre('save', utils.counter.getIdGenerator('WF', 'workflow', null, null, 1000));
// schema.pre('save', mongooseUtils.generateId('WF', 'workflow', null, null, 1000));

// schema.pre('save', dataStackUtils.auditTrail.getAuditPreSaveHook('workflow'));

schema.pre('save', function (next) {
	let self = this;
	let promise = Promise.resolve();
	if (!self.isNew) {
		promise = model.findOne({ _id: self._id });
	}
	promise.then(doc => {
		if (doc) {
			self.oldStatus = doc.status;
		} else {
			self.oldStatus = null;
		}
		next();
	}).catch(err => {
		logger.error(err);
		next(err);
	});
});


schema.pre('save', function (next) {
	let self = this;
	let promise = Promise.resolve();
	if (self.operation == 'POST' && !self.data.new._id) {
		promise = utils.counter.generateId(config.ID_PREFIX, config.serviceCollection, config.ID_SUFFIX, config.ID_PADDING, config.ID_COUNTER).then(id => {
			self.data.new._id = id;
			return self;
		});
	}
	promise.then(() => {
		if (self.data.new && self.data.new._id && !self.documentId) {
			self.documentId = self.data.new._id;
		}
		if (self.data.old && self.data.old._id && !self.documentId) {
			self.documentId = self.data.old._id;
		}
		next();
	}).catch(err => {
		logger.error(err);
		next(err);
	});
});


schema.pre('save', function (next) {
	let self = this;
	if (!(self.isNew)) {
		self.audit[(self.audit.length) - 1].attachments = self.audit[(self.audit.length) - 1].attachments.map(function (value) {
			if (!value.href) {
				value.href = `/api/c/${config.app}${config.serviceEndpoint}/utils/file/download/${value.filename}`;
			}
			return value;
		});
	}
	return next();
});

schema.pre('save', function (next) {
	let self = this;
	if (self.isNew && self.documentId) {
		model.findOne({ serviceId: self.serviceId, documentId: self.documentId, status: { $in: ['Pending', 'SendForRework'] } })
			.then(_doc => {
				if (_doc) {
					next(new Error('Workflow already present for documentID ' + self.documentId));
				} else {
					next();
				}
			});
	} else {
		next();
	}
});


schema.pre('save', async function (next) {
	const req = this._req;
	const txnId = req.headers[global.txnIdHeader] || req.headers['txnid'];
	if (this.operation == 'DELETE') return next();
	if (this.status != 'Pending') return next();
	try {
		logger.debug(`[${txnId}] Calling Prehook before submit :: ${this._id}`);
		logger.trace(`[${txnId}] Calling Prehook before submit :: ${JSON.stringify(this.data.new)}`);
		let options = {
			operation: this.operation,
			simulate: true,
			source: 'presave'
		};
		if (this._isEncrypted) {
			await specialFields.decryptSecureFields(req, this.data.new, null);
			this._isEncrypted = false;
		}
		const data = await hooksUtils.callAllPreHooks(req, this.data.new, options);
		this.data.new = data;
		next();
	} catch (e) {
		next(e);
	}
});

schema.pre('save', function (next) {
	const newDoc = this;
	const oldDoc = this._oldDoc;
	
	if ( serviceData.stateModel && serviceData.stateModel.enabled && !oldDoc && 
		!serviceData.stateModel.initialStates.includes( _.get(newDoc, serviceData.stateModel.attribute) ) ) {
		return next(new Error('Record is not in initial state.'));
	}

	if (serviceData.stateModel && serviceData.stateModel.enabled && oldDoc 
		&& !serviceData.stateModel.states[_.get(oldDoc, serviceData.stateModel.attribute)].includes(_.get(newDoc, serviceData.stateModel.attribute)) 
		&& _.get(oldDoc, serviceData.stateModel.attribute) !== _.get(newDoc, serviceData.stateModel.attribute)) {
		return next(new Error('State transition is not allowed'));
	}
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
	const newDoc = this.data.new;
	const oldDoc = this.data.old;
	const req = this._req;
	try {
		if (this.operation != 'DELETE' && this.status == 'Pending' && !this._isEncrypted) {
			const errors = await specialFields.encryptSecureFields(req, newDoc, oldDoc);
			if (errors) {
				next(errors);
			} else {
				next();
			}
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
		const errors = await specialFields.validateDateFields(req, newDoc.data.new, oldDoc);
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
	const newDoc = this.data.new;
	const oldDoc = this.data.old;
	const req = this._req;
	if (req.body && req.body.action) {
		next();
	} else {
		try {
			const errors = await specialFields.validateUnique(req, newDoc, oldDoc);
			if (errors) {
				next(errors);
			} else {
				next();
			}
		} catch (e) {
			next(e);
		}
	}
});

schema.pre('save', function (next) {
	let doc = this.toObject();
	Object.keys(doc).forEach(el => this.markModified(el));
	next();
});


// schema.post('save', dataStackUtils.auditTrail.getAuditPostSaveHook('workflow.audit', client, 'auditQueue'));

schema.post('save', function (doc, next) {
	const req = doc._req;
	const txnid = req.headers[global.txnIdHeader] || req.headers['txnid'];
	logger.debug(`[${txnid}] Workflow :: ${doc._id} :: Old status - ${this.oldStatus}, New status - ${doc.status}`);
	if (!(this.oldStatus === doc.status)) {
		doc = doc.toObject();
		let auditData = doc;
		auditData.type = statusMap[doc.status];
		auditData.txnId = txnid;
		if (auditData.type) hooksUtils.prepWorkflowHooks(auditData);
	}
	next();
});

// model = authorDB.model('workflow', schema, 'workflow');
model = mongoose.model('workflow', schema, `${config.serviceCollection}.workflow`);
// hookModel = mongoose.model('workflow.hooks', hookSchema, `${config.serviceCollection}.hooks`)