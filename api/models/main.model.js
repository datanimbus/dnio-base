const mongoose = require('mongoose');
const utils = require('@appveen/utils');
const _ = require('lodash');

const config = require('../../config');
const queue = require('../../queue');
const definition = require('../helpers/service.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');
const hooksUtils = require('../utils/hooks.utils');
const specialFields = require('../utils/special-fields.utils');

const client = queue.client;
const logger = global.logger;

const schema = new mongoose.Schema(definition, {
    usePushEach: true
});

schema.plugin(mongooseUtils.metadataPlugin());
schema.plugin(specialFields.mongooseUniquePlugin());

schema.pre('validate', async function (next) {
    const newDoc = this.toObject();
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

schema.pre('save', utils.counter.getIdGenerator(config.ID_PREFIX, config.serviceCollection, config.ID_SUFFIX, config.ID_PADDING, config.ID_COUNTER));

schema.pre('save', async function (next) {
    const newDoc = this.toObject();
    const oldDoc = this._oldDoc;
    const req = this._req;
    try {
        const data = await hooksUtils.callAllPreHooks(req, this);
        _.assign(this, data);
        next();
    } catch (e) {
        next(e);
    }
});

schema.pre('save', function (next) {
    const newDoc = this.toObject();
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
    const newDoc = this.toObject();
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
    const newDoc = this.toObject();
    const oldDoc = this._oldDoc;
    const req = this._req;
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
});

schema.pre('save', async function (next) {
    const newDoc = this.toObject();
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
    const newDoc = this.toObject();
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


schema.post('save', function (doc) {
    const req = doc._req;
    const newData = doc.toObject();
    const oldData = doc._oldData ? JSON.parse(JSON.stringify(doc._oldData)) : null;
    const webHookData = {};
    webHookData._id = newData._id;
    webHookData.data = {};
    webHookData.data.new = JSON.stringify(newData);
    webHookData.data.old = JSON.stringify(oldData);
    webHookData.user = req.headers[global.userHeader];
    webHookData.txnId = req.headers[global.txnIdHeader];
    webHookData.timeStamp = new Date()
    queue.sendToQueue(webHookData);
    let auditData = {};
    auditData.versionValue = '-1'
    auditData.user = webHookData.user;
    auditData.txnId = webHookData.txnId;
    auditData.timeStamp = webHookData.timeStamp;
    auditData.data = {};
    auditData.data.old = {};
    auditData.data.new = {};
    auditData._metadata = {};
    auditData.colName = `${config.app}.${config.serviceCollection}.audit`;
    auditData._metadata.lastUpdated = new Date();
    auditData._metadata.createdAt = new Date();
    auditData._metadata.deleted = false;
    auditData.data._id = JSON.parse(webHookData.data.new)._id;
    auditData.data._version = JSON.parse(webHookData.data.new)._metadata.version.document;
    getDiff(JSON.parse(webHookData.data.old), JSON.parse(webHookData.data.new), auditData.data.old, auditData.data.new);
    let oldLastUpdated = auditData.data.old && auditData.data.old._metadata ? auditData.data.old._metadata.lastUpdated : null;
    let newLastUpdated = auditData.data.new && auditData.data.new._metadata ? auditData.data.new._metadata.lastUpdated : null;
    if (oldLastUpdated) delete auditData.data.old._metadata.lastUpdated;
    if (newLastUpdated) delete auditData.data.new._metadata.lastUpdated;
    if (!_.isEqual(auditData.data.old, auditData.data.new)) {
        if (oldLastUpdated) auditData.data.old._metadata.lastUpdated = oldLastUpdated;
        if (newLastUpdated) auditData.data.new._metadata.lastUpdated = newLastUpdated;
        if (auditData.versionValue != 0) {
            client.publish('auditQueue', JSON.stringify(auditData))
        }
    }
});

mongoose.model(config.serviceId, schema, config.serviceCollection);

function getDiff(a, b, oldData, newData) {
    if (a === null || b === null) {
        Object.assign(oldData, a);
        Object.assign(newData, b);
    }
    else if (typeof a == "object" && typeof b == "object") {
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