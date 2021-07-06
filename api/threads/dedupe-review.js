const { parentPort, workerData } = require('worker_threads');
const _ = require('lodash');
const mongoose = require('mongoose');
mongoose.set('useFindAndModify', false);

const config = require('../../config');
require('../../queue');

const log4js = require('log4js');
const LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceName} v.${config.serviceVersion}] [Worker]` : `[${config.serviceName} v.${config.serviceVersion}] [Worker]`;
const LOG_LEVEL = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info';
log4js.configure({
    appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
    categories: { default: { appenders: ['out'], level: LOG_LEVEL } }
});
const logger = log4js.getLogger(LOGGER_NAME);

global.logger = logger;
global.userHeader = 'user';
global.txnIdHeader = 'txnId';

require('../../db-factory');

async function execute() {
    const model = mongoose.model('dedupe');
    const serviceModel = mongoose.model(config.serviceId);

    logger.level = LOG_LEVEL;
    const dedupeId = workerData.dedupeId;
    const dedupeFields = workerData.dedupeFields;
    const req = workerData.reqData;
    const user = req.headers[global.userHeader];
    try {
        let aggregateQuery = [
            {
                $group: {
                    _id: {},
                    docs: { $push: "$$ROOT" },
                    docsCount: { $sum: 1 }
                }
            }, {
                $match: {
                    docsCount: { $gt: 1 }
                }
            }, {
                $project: {
                    _id: 0,
                    criteria: "$_id",
                    docs: 1,
                    docsCount: 1
                }
            }
        ]
        dedupeFields.forEach(field => {
            aggregateQuery[0]['$group']['_id'][field] = '$' + field;
        })
        let cursor = serviceModel.aggregate(aggregateQuery).cursor().exec();
        await createDedupeRecords(cursor, dedupeId, user);
        logger.debug(`Created dedupe records with Dedupe ID ${dedupeId} for user ${user}`);
        return {
            message: 'Dedupe records are created.',
            user: user
        }
    } catch (e) {
        logger.error(`Error in executiing dedupe-review thread :: `, e);
        throw e;
    }

    async function createDedupeRecords(cursor, dedupeId, user) {
        try {
            let doc = await cursor.next();
            if (!doc) {
                return;
            }
            doc = new model(doc);
            doc.dedupeId = dedupeId;
            doc.user = user;
            await doc.save();
            return createDedupeRecords(cursor, dedupeId, user);
        } catch (e) {
            logger.error('Error in createDedupeRecords :: ', e);
            throw e;
        }
    }
}

setTimeout(() => {
    execute().then(result => {
        parentPort.postMessage(result);
    }).catch(err => {
        throw err;
    });
}, 1000);