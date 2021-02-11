const mongoose = require('mongoose');
const utils = require('@appveen/utils');
// const dataStackUtils = require('@appveen/data.stack-utils');

const config = require('../../config');
const queue = require('../../queue');
const definition = require('../helpers/workflow.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');

// const client = queue.client;
const logger = global.logger;
// const authorDB = global.authorDB;
let model;

const schema = new mongoose.Schema(definition, {
	usePushEach: true
});

schema.plugin(mongooseUtils.metadataPlugin());

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

// schema.post('save', dataStackUtils.auditTrail.getAuditPostSaveHook('workflow.audit', client, 'auditQueue'));

schema.post('save', function (doc) {
	logger.debug(this.oldStatus + ' ' + doc.status);
	if (!(this.oldStatus === doc.status)) {
		doc = doc.toObject();
		let auditData = { data: doc, serviceId: doc.serviceId };
		let statusMap = {
			Pending: 'submit',
			Approved: 'approve',
			Rejected: 'reject',
			Discarded: 'discard',
			Rework: 'rework'
		};
		auditData.type = statusMap[doc.status];
		if (auditData.type) {
			logger.debug('Sending NE for workflowHook ' + JSON.stringify(auditData));
			queue.sendToQueue(auditData);
		}
	}
});

// model = authorDB.model('workflow', schema, 'workflow');
model = mongoose.model('workflow', schema, `${config.serviceCollection}.workflow`)