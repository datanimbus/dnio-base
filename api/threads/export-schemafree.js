let fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const log4js = require('log4js');
const uuid = require('uuid/v1');
let lineReader = require('line-reader');
let archiver = require('archiver');

const config = require('../../config');
const crudderUtils = require('./../utils/crudder.utils');
require('../../db-factory');

const { parentPort, workerData } = require('worker_threads');

mongoose.set('useFindAndModify', false);

global.baseKey = workerData.baseKey;
global.baseCert = workerData.baseCert;
global.encryptionKey = workerData.encryptionKey;

const LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceName} v.${config.serviceVersion}] [Worker]` : `[${config.serviceName} v.${config.serviceVersion}] [Worker]`;
const LOG_LEVEL = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info';
log4js.configure({
    appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
    categories: { default: { appenders: ['out'], level: LOG_LEVEL } }
});
const logger = log4js.getLogger(LOGGER_NAME);

function flatten(obj, deep, parent) {
    let temp = {};
    if (obj) {
        Object.keys(obj).forEach(function (key) {
            const thisKey = parent ? parent + '.' + key : key;
            if (typeof obj[key] === 'object' && key != '_id') {
                if (Array.isArray(obj[key])) {
                    if (deep) {
                        obj[key].forEach((item, i) => {
                            if (typeof item === 'object') {
                                Object.assign(temp, flatten(item, deep, thisKey + '.' + i));
                            } else {
                                temp[thisKey + '.' + i] = item;
                            }
                        });
                    } else {
                        temp[thisKey] = obj[key];
                    }
                }
                else if (obj[key] instanceof Date) {
                    temp[thisKey] = obj[key];
                }
                else {
                    temp = Object.assign(temp, flatten(obj[key], deep, thisKey));
                }
            }
            else {
                if (typeof obj[key] == 'boolean') obj[key] = obj[key].toString();
                if (!(parent && key == '_id' && typeof (obj[key]) == 'object')) temp[thisKey] = obj[key];
            }
        });
        return temp;
    }
}


async function execute() {
    let reqData = workerData.reqData;
    let txnId = reqData.headers.txnid;
    logger.info(`[${txnId}] Executing export schema free records thread for service ${config.serviceId}`);
    
    const serviceModel = mongoose.model(config.serviceId);
    const fileTransfersModel = mongoose.model('fileTransfers');

    const BATCH = 500;
    logger.level = LOG_LEVEL;
    let fileId = workerData.fileId;
    let d = new Date();
    Number.prototype.padLeft = function (base, chr) {
        var len = (String(base || 10).length - String(this).length) + 1;
        return len > 0 ? new Array(len).join(chr || '0') + this : this;
    };
    let formats = [(d.getDate()).padLeft(), (d.getMonth() + 1).padLeft(), (d.getFullYear() - 2000)].join('') + '-' + [d.getHours().padLeft(), d.getMinutes().padLeft(), d.getSeconds().padLeft()].join('');

    let fileName = config.serviceName;
    fileName = fileName.replace(/\//g, '_') + '-' + formats;
    let downloadFile = config.serviceName + '-' + formats + '.zip';
    downloadFile = downloadFile.replace(/\//g, '_');

    let select = reqData.query.select || '';
    select = select ? select.split(',') : [];

    var totalRecords;
    let outputDir = './output/';
    var txtWriteStream = fs.createWriteStream(outputDir + fileName + '.txt');
    let headersObj = {};
    let cursor;
    let jsonFileNames = [];

    try {
        let filter = reqData.query.filter;
        if (filter) {
            filter = typeof filter === 'string' ? JSON.parse(filter) : filter;
        }

        logger.debug(`[${txnId}] Filter for export :: ${JSON.stringify(filter)}`);
        logger.debug(`[${txnId}] Fields to select :: ${JSON.stringify(select)}`);

        let count = await serviceModel.countDocuments(filter);
        totalRecords = count;

        const data = {
            _id: fileId,
            fileName: downloadFile,
            status: 'Pending',
            user: reqData.headers['user'],
            type: 'export',
            validCount: totalRecords,
            _metadata: {
                deleted: false,
                lastUpdated: new Date(),
                createdAt: new Date()
            }
        };
        let transferDoc = new fileTransfersModel(data);
        transferDoc._req = reqData;
        transferDoc = await transferDoc.save();

        let arr = [];
        let totalBatches = count / BATCH;
        for (let i = 0; i < totalBatches; i++) {
            arr.push(i);
        }
        reqData.query.batchSize = reqData.query.batchSize ? reqData.query.batchSize : BATCH;
        reqData.query.filter = filter;
        cursor = crudderUtils.cursor(reqData, serviceModel);

        /********** Fetching documents from DB *********/
        await arr.reduce(async (_p, curr, i) => {
            await _p;
            logger.debug(`[${txnId}] Running batch :: ${i + 1}`);
            var documents = [];
            for (var j = 0; j < BATCH; j++) {
                let doc = await cursor.next();
                if (doc) documents.push(doc);
                else break;
            }

            logger.debug(`[${txnId}] Fetched documents for batch :: ${i + 1}`);
            logger.trace(`[${txnId}] Fetched documents for batch :: ${i + 1} :: ${JSON.stringify(documents)}`);

            documents = documents.map(doc => {
                delete doc._metadata;
                delete doc._workflow;
                delete doc.__v;
                return doc;
            });

            /******** Writing documents in JSON files *******/
            await new Promise((resolve) => {
                documents.forEach(doc => {
                    let fileName = doc._id + '.json';
                    logger.trace(`[${txnId}] Creating JSON file :: ${fileName}`);
                    jsonFileNames.push(fileName);
                    let jsonWriteStream = fs.createWriteStream(outputDir + fileName);
                    jsonWriteStream.write(JSON.stringify(doc));
                    jsonWriteStream.end();
                });
                resolve();
            });
        }, Promise.resolve());

        /******* Praparing ZIP file from JSON file ******/
        await new Promise((resolve, reject) => {
            let archive = archiver('zip', {
                zlib: { level: 9 } // Sets the compression level.
            });
            let zipWriteStream = fs.createWriteStream(outputDir + downloadFile);
            zipWriteStream.on('close', function () {
                logger.debug(`[${txnId}] Zip file has been created. Uploading to mongo...`);
                resolve();
            });
            archive.pipe(zipWriteStream);

            jsonFileNames.forEach(f => {
                archive.file(outputDir + f, { name: f });
            });

            archive.finalize();
            archive.on('error', (err) => {
                logger.error(`[${txnId}] Error in creating zip file :: ${err}`);
                reject(err);
            });
        });

        /******** Uploading ZIP file to DB *******/
        let result = await new Promise((resolve, reject) => {
            fs.createReadStream(outputDir + downloadFile).
                pipe(global.gfsBucketExport.openUploadStream(crypto.createHash('md5').update(uuid() + global.serverStartTime).digest('hex'), {
                    contentType: 'application/zip',
                    metadata: {
                        filename: downloadFile,
                        uuid: fileId
                    }
                })).on('error', async function (error) {
                    logger.error(`[${txnId}] Error in uplaoding zip to GFS bucket :: ${error}`);
                    await fileTransfersModel.updateOne({ _id: fileId }, { $set: { status: 'Error', '_metadata.lastUpdated': new Date() } });
                    reject({
                        _id: fileId,
                        status: 'Error',
                        userId: reqData.headers['user'],
                        totalRecords: totalRecords
                    });
                }).on('finish', async function () {
                    logger.info(`[${txnId}] Uploaded file to mongo :: ${fileId}`);
                    await fileTransfersModel.updateOne({ _id: fileId }, { $set: { status: 'Completed', '_metadata.lastUpdated': new Date() } });
                    resolve({
                        _id: fileId,
                        status: 'Completed',
                        userId: reqData.headers['user'], totalRecords: totalRecords
                    });
                });
        });
        return result;
    } catch (e) {
        logger.error(`[${txnId}] Error in export execute :: ${e}`);
        throw e;
    } finally {
        try {
            if (cursor) cursor.close();
        } catch (e) { logger.error(`[${txnId}] Error in closing cursor :: ${e}`); }
        mongoose.disconnect();

        /****** Removing txt, csv and zip files if exist ******/
        let filesToRemove = [outputDir + fileName + '.txt', outputDir + downloadFile];
        jsonFileNames.map(file => filesToRemove.push(outputDir + file));
        logger.info(`[${txnId}] Deleting files :: ${filesToRemove}`);
        filesToRemove.forEach(file => {
            if (fs.existsSync(file)) {
                fs.unlink(file, (err) => {
                    if (err) logger.error(`[${txnId}] Error in deleting file :: ${file} :: ${err}`);
                });
            }
        });
    }
}

setTimeout(() => {
    execute().then(result => {
        parentPort.postMessage(result);
    }).catch(err => {
        throw err;
    });
}, 1000);
