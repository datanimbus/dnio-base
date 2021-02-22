const mongoose = require('mongoose');
const utils = require('@appveen/utils');
// const dataStackUtils = require('@appveen/data.stack-utils');

const config = require('../../config');
const definition = require('../helpers/workflow.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');
const hooksUtils = require('../utils/hooks.utils');
const specialFields = require('../utils/special-fields.utils');

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