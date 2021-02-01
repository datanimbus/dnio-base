
'use strict';

if (process.env.NODE_ENV != 'production') {
    require('dotenv').config();
}

const path = require('path');
const express = require('express');
const bluebird = require('bluebird');
const multer = require('multer');
const bodyParser = require('body-parser');
const log4js = require('log4js');
const mongoose = require('mongoose');
mongoose.set('useFindAndModify', false);
const utils = require('@appveen/utils');
const dataStackUtils = require('@appveen/data.stack-utils');

const config = require('./config');

let baseImageVersion = require('./package.json').version;
const LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceName} v.${config.serviceVersion}]` : `[${config.serviceName} v.${config.serviceVersion}]`

const LOG_LEVEL = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info';

const PORT = config.servicePort;

log4js.configure({
    appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
    categories: { default: { appenders: ['out'], level: LOG_LEVEL } }
});

const app = express();
const upload = multer({ dest: path.join(process.cwd(), 'uploads') });
const fileValidator = utils.fileValidator;
const logger = log4js.getLogger(LOGGER_NAME);
logger.info(`Service version : ${config.serviceVersion}`)
logger.info(`Base image version : ${baseImageVersion}`)

global.Promise = bluebird;
global.serverStartTime = new Date();
global.status = null;
global.activeRequest = 0;
global.loggerName = LOGGER_NAME;
global.logger = logger;

require('./db-factory');
const queueMgmt = require('./queue');
const init = require('./init');
const specialFields = require('./api/utils/special-fields.utils');

let timeOut = process.env.API_REQUEST_TIMEOUT || 120;
let secureFields = specialFields.secureFields;
let baseURL = `/${config.app}/${config.serviceEndpoint}`;
let masking = [
    { url: `${baseURL}`, path: secureFields },
    { url: `${baseURL}/utils/simulate`, path: secureFields },
    { url: `${baseURL}/{id}`, path: secureFields },
    { url: `${baseURL}/utils/experienceHook`, path: secureFields }
];
const logToQueue = dataStackUtils.logToQueue(`${config.app}.${config.serviceId}`, queueMgmt.client, 'dataService', `${config.app}.${config.serviceId}.logs`, masking, config.serviceId);

app.use(bodyParser.json({ limit: config.MaxJSONSize }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(utils.logMiddleware.getLogMiddleware(logger));
app.use(upload.single('file'));
app.use(logToQueue);
app.use(function (req, res, next) {
    let allowedExt = config.allowedExt || [];
    if (!req.files) return next();
    logger.debug(`[${req.get('TxnId')}] File upload in request`);
    let flag = Object.keys(req.files).every(file => {
        let filename = req.files[file].name;
    		logger.debug(`[${req.get('TxnId')}] File upload :: filename :: ${filename}`);
        let fileExt = filename.split('.').pop();
    		logger.debug(`[${req.get('TxnId')}] File upload :: fileExt :: ${fileExt}`);
        if (allowedExt.indexOf(fileExt) == -1) {
        	logger.error(`[${req.get('TxnId')}] File upload :: fileExt :: Not permitted`);
        	return false
        }
        let isValid = fileValidator({ type: 'Buffer', data: req.files[file].data }, fileExt);
        logger.info(`[${req.get('TxnId')}] Is file ${filename} valid? ${isValid}`);
        return isValid;
    });
    if (flag) next();
    else next(new Error('File not supported'));
});

app.use((req, res, next) => {
    if (req.path.split('/').indexOf('health') == -1) {
        logger.trace(`[${req.get('TxnId')}] req.path : ${req.path}`);
        logger.trace(`[${req.get('TxnId')}] req.headers : ${JSON.stringify(req.headers)} `);
    }
    global.activeRequest++;
    res.on('close', function () {
        global.activeRequest--;
        if (req.path.split('/').indexOf('live') == -1 && req.path.split('/').indexOf('ready') == -1) {
            logger.debug(`[${req.get('TxnId')}] Request completed for ${req.path}`);
        }
    });
    next();
});

app.use('/' + config.app + config.serviceEndpoint, require('./api/controllers'));

app.use((err, req, res, next) => {
    if (err) {
        logger.error(`[${req.get('TxnId')}] ${err.message}`);
        if (!res.headersSent) {
        		logger.error(`[${req.get('TxnId')}] Headers sent - ${res.headersSent}`);
            return res.status(500).json({ message: err.message });
        }
    }
    next();
});

const server = app.listen(PORT, (err) => {
    if (!err) {
        logger.info('Server started on port ' + PORT);
        queueMgmt.client.on('connect', function () {
            init();
        });
    } else {
        logger.error(err);
        process.exit(0);
    }
});

server.setTimeout(parseInt(timeOut) * 1000);

process.on('SIGTERM', () => {
    try {
        // Handle Request for 15 sec then stop recieving
        setTimeout(() => {
            global.stopServer = true;
        }, 15000);
        logger.info('Process Kill Request Recieved');
        // Stopping CRON Job;
        global.job.cancel();
        const intVal = setInterval(() => {
            // Waiting For all pending requests to finish;
            if (global.activeRequest === 0) {
                // Closing Express Server;
                server.close(() => {
                    logger.info('Server Stopped.');
                    if (mongoose.connection) {
                        mongoose.connection.close(false, (err) => {
                            if (err) {
                                logger.error('MongoDB connection close', err);
                            } else {
                                logger.info('MongoDB connection closed.');
                            }
                            process.exit(0);
                        });
                    } else {
                        process.exit(0);
                    }
                });
                clearInterval(intVal);
            } else {
                logger.info('Waiting for request to complete, Active Requests:', global.activeRequest);
            }
        }, 2000);
    } catch (e) {
        logger.error('SIGTERM Handler', e);
        process.exit(0);
    }
});