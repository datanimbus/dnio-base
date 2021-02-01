const mongoose = require('mongoose');
// const log4js = require('log4js');
const NodeCache = require('node-cache');

const config = require('./config');
const models = require('./api/models');

// let baseImageVersion = require('./package.json').version;
// const LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceName} v${config.serviceVersion}]` : `[${config.serviceName} v${config.serviceVersion}]`
// const logger = log4js.getLogger(LOGGER_NAME);
let logger = global.logger
const dbName = config.serviceDB;

// global.logger = logger;
global.userHeader = 'user';
global.txnIdHeader = 'txnId';
global.serviceCache = new NodeCache({ stdTTL: 60, checkperiod: 120, useClones: false });
global.documentCache = new NodeCache({ stdTTL: 60, checkperiod: 120, useClones: false });
global.trueBooleanValues = ['y', 'yes', 'true', 'yeah', 'affirmative', 'ok'];

const authorDB = mongoose.createConnection(config.mongoAuthorUrl + '/' + config.authorDB + '?authSource=admin', config.mongoOptions);
authorDB.on('connecting', () => { logger.info(` *** ${config.authorDB} CONNECTING *** `); });
authorDB.on('disconnected', () => { logger.error(` *** ${config.authorDB} LOST CONNECTION *** `); });
authorDB.on('reconnect', () => { logger.info(` *** ${config.authorDB} RECONNECTED *** `); });
authorDB.on('connected', () => { logger.info(`Connected to ${config.authorDB} DB`); });
authorDB.on('reconnectFailed', () => { logger.error(` *** ${config.authorDB} FAILED TO RECONNECT *** `); });
global.authorDB = authorDB;

mongoose.connect(config.mongoUrl + '/' + dbName + '?authSource=admin', config.mongoOptions, err => {
    if (err) {
        logger.error(err);
    } else {
        logger.info(`Connected to ${dbName} DB`);
        global.gfsBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: `${config.serviceCollection}` });
        global.gfsBucketExport = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: `${config.serviceCollection}.exportedFile` });
        global.gfsBucketImport = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: `${config.serviceCollection}.fileImport` });
    }
});

mongoose.connection.on('connecting', () => { logger.info(` *** ${dbName} CONNECTING *** `); });
mongoose.connection.on('disconnected', () => { logger.error(` *** ${dbName} LOST CONNECTION *** `); });
mongoose.connection.on('reconnect', () => { logger.info(` *** ${dbName} RECONNECTED *** `); });
mongoose.connection.on('connected', () => { logger.info(`Connected to ${dbName} DB`); });
mongoose.connection.on('reconnectFailed', () => { logger.error(` *** ${dbName} FAILED TO RECONNECT *** `); });

models.init();