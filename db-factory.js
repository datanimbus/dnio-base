const mongoose = require('mongoose');
// const log4js = require('log4js');
const NodeCache = require('node-cache');

const config = require('./config');
const models = require('./api/models');

// let baseImageVersion = require('./package.json').version;
// const LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceName} v${config.serviceVersion}]` : `[${config.serviceName} v${config.serviceVersion}]`
// const logger = log4js.getLogger(LOGGER_NAME);
let logger = global.logger;
const dbName = config.serviceDB;

// For threads to pick txnId and user headers
global.userHeader = 'user';
global.txnIdHeader = 'txnid';

// global.logger = logger;
global.serviceCache = new NodeCache({ stdTTL: 60, checkperiod: 120, useClones: false });
global.documentCache = new NodeCache({ stdTTL: 60, checkperiod: 120, useClones: false });
global.trueBooleanValues = ['y', 'yes', 'true', '1'];
global.falseBooleanValues = ['n', 'no', 'false', '0'];

function setIsTransactionAllowed() {
	global.isTransactionAllowed = false;
	try {
		mongoose.connection.db.admin().command({'replSetGetStatus':1 }, async function (err, replicaSetStatus) {
			logger.trace('Replica Status :: ', replicaSetStatus);
			if(replicaSetStatus) {
				let dbVersion = (await mongoose.connection.db.admin().serverInfo()).version;
				logger.debug('Appcenter Db Version :: ', dbVersion);
				global.isTransactionAllowed = dbVersion && dbVersion >= '4.2.0';
			}
			logger.info('Are MongoDb Transactions Allowed :: ', global.isTransactionAllowed);
		});
	} catch(e) {
		logger.error('Error in setIsTransactionAllowed :: ', e);
	}
}

const authorDB = mongoose.createConnection(config.mongoAuthorUrl, config.mongoAuthorOptions);
authorDB.on('connecting', () => { logger.info(` *** ${config.authorDB} CONNECTING *** `); });
authorDB.on('disconnected', () => { logger.error(` *** ${config.authorDB} LOST CONNECTION *** `); });
authorDB.on('reconnect', () => { logger.info(` *** ${config.authorDB} RECONNECTED *** `); });
authorDB.on('connected', () => { logger.info(`Connected to ${config.authorDB} DB`); });
authorDB.on('reconnectFailed', () => { logger.error(` *** ${config.authorDB} FAILED TO RECONNECT *** `); });
global.authorDB = authorDB;

const logsDB = mongoose.createConnection(config.mongoLogUrl, config.mongoLogsOptions);
logsDB.on('connecting', () => { logger.info(` *** ${config.logsDB} CONNECTING *** `); });
logsDB.on('disconnected', () => { logger.error(` *** ${config.logsDB} LOST CONNECTION *** `); });
logsDB.on('reconnect', () => { logger.info(` *** ${config.logsDB} RECONNECTED *** `); });
logsDB.on('connected', () => { logger.info(`Connected to ${config.logsDB} DB`); });
logsDB.on('reconnectFailed', () => { logger.error(` *** ${config.logsDB} FAILED TO RECONNECT *** `); });
global.logsDB = logsDB;

mongoose.connect(config.mongoUrl, config.mongoAppCenterOptions, err => {
	if (err) {
		logger.error(err);
	} else {
		logger.info(`Connected to ${dbName} DB`);
		global.gfsBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: `${config.serviceCollection}` });
		global.gfsBucketExport = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: `${config.serviceCollection}.exportedFile` });
		global.gfsBucketImport = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: `${config.serviceCollection}.fileImport` });
		setIsTransactionAllowed();
	}
});

mongoose.connection.on('connecting', () => { logger.info(` *** ${dbName} CONNECTING *** `); });
mongoose.connection.on('disconnected', () => { logger.error(` *** ${dbName} LOST CONNECTION *** `); });
mongoose.connection.on('reconnect', () => { logger.info(` *** ${dbName} RECONNECTED *** `); });
mongoose.connection.on('connected', () => { logger.info(`Connected to ${dbName} DB`); });
mongoose.connection.on('reconnectFailed', () => { logger.error(` *** ${dbName} FAILED TO RECONNECT *** `); });

models.init();