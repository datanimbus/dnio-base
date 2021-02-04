const { parentPort, workerData } = require('worker_threads');
const _ = require('lodash');
const mongoose = require('mongoose');
mongoose.set('useFindAndModify', false);

const config = require('../../config');

const log4js = require('log4js');
const LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceName} v.${config.serviceVersion}] [Worker]` : `[${config.serviceName} v.${config.serviceVersion}] [Worker]`
const LOG_LEVEL = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info';
log4js.configure({
    appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
    categories: { default: { appenders: ['out'], level: LOG_LEVEL } }
});
const logger = log4js.getLogger(LOGGER_NAME);

global.logger = logger

require('../../db-factory');

async function execute() {
    const workflowUtils = require('../utils/workflow.utils');
    const authorDB = global.authorDB;
    const workflowModel = authorDB.model('workflow');
    const model = mongoose.model('fileMapper');
    const serviceModel = mongoose.model(config.serviceId);

    logger.level = LOG_LEVEL;
    const fileId = workerData.fileId;
    const data = workerData.data;
    const create = data.create ? data.create : [];
    const update = data.update ? data.update : [];
    const req = workerData.req;

    /**---------- After Response Process ------------*/
    let docsToCreate = await model.find({ fileId, $or: [{ status: 'Validated' }, { sNo: { $in: create } }] });
    let createBatch = [docsToCreate];
    if (docsToCreate.length > 2500) {
        createBatch = _.chunk(docsToCreate, 2500);
    }
    await createBatch.reduce((prev, docs) => {
        return prev.then(() => {
            let temp = docs.map(async (doc) => {
                try {
                    if (workflowUtils.isWorkflowEnabled() && !workflowUtils.hasSkipReview(req)) {
                        const wfItem = workflowUtils.getWorkflowItem(req, 'POST', doc.data._id, 'Submited', doc.data, null);
                        const wfDoc = new workflowModel(wfItem);
                        wfDoc._req = req;
                        const status = await wfDoc.save();
                        if (!doc._metadata) {
                            doc._metadata = {};
                        }
                        doc._metadata.workflow = status._id;
                    } else {
                        const temp = new serviceModel(doc.data);
                        temp._req = req;
                        const newDoc = await temp.save();
                    }
                    doc.status = 'Created';
                } catch (e) {
                    doc.status = 'Error';
                    doc.message = e.message;
                } finally {
                    return await doc.save();
                }
            });
            return Promise.all(temp);
        });
    }, Promise.resolve());

    let docsToUpdate = await model.find({ fileId, sNo: { $in: update } });
    let updateBatch = [docsToCreate];
    if (docsToUpdate.length > 2500) {
        updateBatch = _.chunk(docsToUpdate, 2500);
    }
    await updateBatch.reduce((prev, docs) => {
        return prev.then(() => {
            let temp = docs.map(async (doc) => {
                try {
                    let temp = await serviceModel.findById(doc.data._id);
                    if (workflowUtils.isWorkflowEnabled() && !workflowUtils.hasSkipReview(req)) {
                        const wfItem = workflowUtils.getWorkflowItem(req, 'POST', doc.data._id, 'Submited', doc.data, temp.toObject());
                        const wfDoc = new workflowModel(wfItem);
                        wfDoc._req = req;
                        const status = await wfDoc.save();
                        if (!doc._metadata) {
                            doc._metadata = {};
                        }
                        doc._metadata.workflow = status._id;
                    } else {
                        temp._oldData = temp.toObject();
                        temp._req = req;
                        _.merge(temp, doc.data);
                        temp = await temp.save();
                    }
                    doc.status = 'Updated';
                } catch (e) {
                    doc.status = 'Error';
                    doc.message = e.message;
                } finally {
                    return await doc.save();
                }
            });
            return Promise.all(temp);
        });
    });
    docsToUpdate = await Promise.all(docsToUpdate);
    const finalData = await model.aggregate([{
        $facet: {
            createdCount: [{ $match: { fileId: fileId, status: 'Created' } }, { $count: 'count' }],
            updatedCount: [{ $match: { fileId: fileId, status: 'Updated' } }, { $count: 'count' }],
            errorCount: [{ $match: { fileId: fileId, status: 'Error' } }, { $count: 'count' }]
        }
    }]);
    const result = {
        createdCount: (finalData[0].createdCount).length > 0 ? finalData[0].createdCount[0].count : 0,
        updatedCount: (finalData[0].updatedCount).length > 0 ? finalData[0].updatedCount[0].count : 0,
        errorCount: (finalData[0].errorCount).length > 0 ? finalData[0].errorCount[0].count : 0,
        status: 'Created',
        '_metadata.lastUpdated': new Date()
    };
    if (result.createdCount == 0) {
        result.status = 'Error';
    }
    mongoose.disconnect();
    return result;
}

setTimeout(() => {
    execute().then(result => {
        parentPort.postMessage(result);
    }).catch(err => {
        throw err;
    });
}, 1000);