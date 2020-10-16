
'use strict';

if (process.env.NODE_ENV != 'production') {
    require('dotenv').config();
}

const path = require('path');
const express = require('express');
const bluebird = require('bluebird');
const multer = require('multer');
const bodyParser = require('body-parser');
const cuti = require('@appveen/utils');
const odpUtils = require('@appveen/odp-utils');

const config = require('./config');
const queueMgmt = require('./queue');

const LOGGER_NAME = undefined ? `[${config.appNamespace}]` + `[${config.hostname}]` : `[${config.serviceName}]`
const PORT = config.servicePort;

const app = express();
const upload = multer({ dest: path.join(process.cwd(), 'uploads') });
const log4js = cuti.logger.getLogger;
const fileValidator = cuti.fileValidator;
const logger = log4js.getLogger(LOGGER_NAME);

global.Promise = bluebird;
global.serverStartTime = new Date();
global.status = null;

require('./db-factory');
const init = require('./init');
const specialFields = require('./api/utils/special-fields.utils');

let timeOut = process.env.API_REQUEST_TIMEOUT || 120;
let secureFields = specialFields.secureFields;
let baseURL = `/${config.app}/${config.serviceId}`;
let masking = [
    { url: `${baseURL}`, path: secureFields },
    { url: `${baseURL}/utils/simulate`, path: secureFields },
    { url: `${baseURL}/{id}`, path: secureFields },
    { url: `${baseURL}/experienceHook`, path: secureFields }
];
const logToQueue = odpUtils.logToQueue(`${config.app}.${config.serviceId}`, queueMgmt.client, 'dataService', `${config.app}.${config.serviceId}.logs`, masking, config.serviceId);

app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cuti.logMiddleware.getLogMiddleware(logger));
app.use(upload.single('file'));
app.use(logToQueue);
app.use(function (req, res, next) {
    let allowedExt = config.allowedExt || [];
    if (!req.files) return next();
    let flag = Object.keys(req.files).every(file => {
        let filename = req.files[file].name;
        let fileExt = filename.split('.').pop();
        if (allowedExt.indexOf(fileExt) == -1) return false;
        let isValid = fileValidator({ type: 'Buffer', data: req.files[file].data }, fileExt);
        return isValid;
    });
    if (flag) next();
    else next(new Error('File not supported'));
});

app.use('/' + config.app + config.serviceEndpoint, require('./api/controllers'));

app.use((err, req, res, next) => {
    if (err) {
        logger.error(err);
        if (!res.headersSent) {
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
    }
});

server.setTimeout(parseInt(timeOut) * 1000);