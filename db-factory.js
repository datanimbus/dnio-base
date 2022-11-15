const fs = require('fs');
const log4js = require('log4js');
const mongoose = require('mongoose');

let config = require('./config');

let logger = global.logger;

async function setIsTransactionAllowed() {
	global.isTransactionAllowed = false;
	try {
		let replicaSetStatus = await mongoose.connection.db.admin().command({ 'replSetGetStatus': 1 });
		logger.trace(`Replica set ${replicaSetStatus.set} / State ${replicaSetStatus.myState}`);
		if (replicaSetStatus) {
			let dbVersion = (await mongoose.connection.db.admin().serverInfo()).version;
			logger.debug(`Appcenter db Version : ${dbVersion}`);
			global.isTransactionAllowed = dbVersion && dbVersion >= '4.2.0';
		}
		logger.info(`Appcenter db supports transactions? ${global.isTransactionAllowed}`);
	} catch (e) {
		logger.error('Error in setIsTransactionAllowed :: ', e.message);
	}
}

async function establishingAppCenterDBConnections() {
	try {
		if (config.connectors.data.type === 'MONGODB') {
			logger.info(`Appcenter DB : ${config.mongoAppCenterOptions.dbName}`);
			await mongoose.connect(config.mongoUrl, config.mongoAppCenterOptions);
			logger.info(`Connected to appcenter db : ${config.serviceDB}`);
			mongoose.connection.on('connecting', () => { logger.info(` *** ${config.serviceDB} CONNECTING *** `); });
			mongoose.connection.on('disconnected', () => { logger.error(` *** ${config.serviceDB} LOST CONNECTION *** `); });
			mongoose.connection.on('reconnect', () => { logger.info(` *** ${config.serviceDB} RECONNECTED *** `); });
			mongoose.connection.on('connected', () => { logger.info(`Connected to ${config.serviceDB} DB`); });
			mongoose.connection.on('reconnectFailed', () => { logger.error(` *** ${config.serviceDB} FAILED TO RECONNECT *** `); });

			if (config.connectors.file.type === 'GRIDFS') {
				global.gfsBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: `${config.serviceCollection}` });
				global.gfsBucketExport = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: `${config.serviceCollection}.exportedFile` });
				global.gfsBucketImport = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: `${config.serviceCollection}.fileImport` });
			}
			await setIsTransactionAllowed();
		}
	} catch (e) {
		logger.error(e.message);
	}
}

async function establishAuthorAndLogsDBConnections() {
	let promises = [];
	logger.debug(`Author DB :: ${config.mongoAuthorOptions.dbName}`);
	const authorDB = mongoose.createConnection(config.mongoAuthorUrl, config.mongoAuthorOptions);
	authorDB.on('connecting', () => { logger.info(` *** ${config.authorDB} CONNECTING *** `); });
	authorDB.on('disconnected', () => { logger.error(` *** ${config.authorDB} LOST CONNECTION *** `); });
	authorDB.on('reconnect', () => { logger.info(` *** ${config.authorDB} RECONNECTED *** `); });
	authorDB.on('connected', () => {
		logger.info(`Connected to author db : ${config.authorDB}`);
		promises.push(Promise.resolve('Connected to AuthorDB'));
	});
	authorDB.on('reconnectFailed', () => { logger.error(` *** ${config.authorDB} FAILED TO RECONNECT *** `); });
	global.authorDB = authorDB;

	logger.debug(`Logs DB :: ${config.mongoLogsOptions.dbName}`);
	const logsDB = mongoose.createConnection(config.mongoLogUrl, config.mongoLogsOptions);
	logsDB.on('connecting', () => { logger.info(` *** ${config.logsDB} CONNECTING *** `); });
	logsDB.on('disconnected', () => { logger.error(` *** ${config.logsDB} LOST CONNECTION *** `); });
	logsDB.on('reconnect', () => { logger.info(` *** ${config.logsDB} RECONNECTED *** `); });
	logsDB.on('connected', () => {
		logger.info(`Connected to logs db : ${config.logsDB}`);
		promises.push(Promise.resolve('Connected to LogsDB'));
	});
	logsDB.on('reconnectFailed', () => { logger.error(` *** ${config.logsDB} FAILED TO RECONNECT *** `); });
	global.logsDB = logsDB;

	await Promise.all(promises);
}

async function fetchServiceDetails(serviceID) {
	try {
		logger.info(`Fetching service details : ${serviceID}`);
		return await global.authorDB.collection('services').findOne({ _id: serviceID });
	} catch (e) {
		logger.error(`Unable to fetch service details :: ${serviceID}`);
		logger.error(e.message);
	}
}

async function fetchGlobalDefinitions() {
	try {
		logger.info(`Fetching global definition details for app ${config.app}`);
		return await global.authorDB.collection('globalSchema').find({ 'app': config.app }).toArray();
	} catch (e) {
		logger.error(`Unable to global definition details ${config.app}`);
		logger.error(e.message);
	}
}

async function fetchConnectorDetails(connID) {
	try {
		logger.info(`Fetching connector details : ${connID}`);
		return await global.authorDB.collection('config.connectors').findOne({ _id: connID });
	} catch (e) {
		logger.error(`Unable to fetch connector details :: ${connID}`);
		logger.error(e.message);
	}
}

function parseSchemaToFindFileAttachmentAttributes(path, definition) {
	let attributes = [];
	definition.forEach(def => {
		if (def.type == 'File') attributes.push(path.concat(def.key).join('.'));
	});
	// TODO: Add missing code for parsing definition recursively
	return attributes;
}

async function initConfigVariables(serviceDoc, reinitLogger) {
	config.app = serviceDoc.app;
	config.appNamespace = (config.namespace + '-' + serviceDoc.app).toLowerCase();
	config.serviceName = serviceDoc.name;
	if (config.isK8sEnv()) {
		config.servicePort = 80;
	} else {
		config.servicePort = serviceDoc.port;
	}
	config.serviceVersion = serviceDoc.version;
	config.serviceDB = `${config.namespace}-${serviceDoc.app}`;
	config.serviceEndpoint = serviceDoc.api;
	config.serviceCollection = serviceDoc.collectionName;

	config.mongoAppCenterOptions.dbName = config.serviceDB;

	serviceDoc.idDetails = serviceDoc['definition'].find(attr => attr.key == '_id');
	serviceDoc.idDetails.counter = parseInt(serviceDoc.idDetails.counter);
	serviceDoc.idDetails.padding = parseInt(serviceDoc.idDetails.padding);

	config.ID_PADDING = serviceDoc.idDetails.padding || null;
	config.ID_PREFIX = serviceDoc.idDetails.prefix || null;
	config.ID_SUFFIX = serviceDoc.idDetails.suffix || null;
	config.ID_COUNTER = serviceDoc.idDetails.counter;

	config.permanentDelete = serviceDoc.permanentDeleteData ? config.parseBoolean(serviceDoc.permanentDeleteData) : true;
	config.disableInsights = serviceDoc.disableInsights;
	config.disableAudits = serviceDoc.versionValidity.validityValue == 0;
	config.allowedExt = serviceDoc.allowedFileTypes ? serviceDoc.allowedFileTypes : config.allFileTypes;

	if (reinitLogger) {
		config.updateLogger(null);
		logger = global.logger;
	}

	logger.info(`Service ID : ${config.serviceId}`);
	logger.info(`Service version : ${config.serviceVersion}`);
	logger.info(`Disable data history : ${config.disableAudits} `);
	logger.info(`Disable insights : ${config.disableInsights} `);
	logger.info(`Disable soft delete : ${config.permanentDelete} `);

	config.fileAttachmentAttributes = parseSchemaToFindFileAttachmentAttributes([], serviceDoc.definition);
	logger.debug(`File attachment attributes : ${config.fileAttachmentAttributes}`);
	logger.debug(`ML_FILE_PARSER : ${config.ML_FILE_PARSER}`);

	config.connectors = {
		data: {},
		file: {}
	};

	config.connectors.data.type = serviceDoc?.connectors?.data?.type || 'MONGODB';
	if (config?.connectors?.data?.type === 'MONGODB') {
		config.connectors.data.Mongo = serviceDoc?.connectors?.data?.Mongo || { connectionString: config.mongoUrl };
	}

	config.connectors.file.type = serviceDoc?.connectors?.file?.type || 'GRIDFS';
	if (config?.connectors?.file?.type === 'GRIDFS') {
		config.connectors.file.Mongo = serviceDoc.connectors?.file?.Mongo;

	} else if (config?.connectors?.file?.type === 'AZBLOB') {
		config.connectors.file.AZURE = serviceDoc.connectors?.file?.AZURE;

	} else if (config?.connectors?.file?.type === 'S3') {
		config.connectors.file.S3 = serviceDoc.connectors?.file?.S3;

	} else if (config?.connectors?.file?.type === 'GCS') {
		config.connectors.file.GCS = serviceDoc.connectors.file.GCS;
	}

	logger.debug(`DATA STORAGE ENGINE :: ${config.connectors.data.type}`);
	logger.debug(`FILE STORAGE ENGINE :: ${config.connectors.file.type}`);
}

async function init() {
	try {
		await establishAuthorAndLogsDBConnections();
		let serviceDoc = await fetchServiceDetails(config.serviceId);
		logger.trace(`Service document :: ${JSON.stringify(serviceDoc)}`);

		let fileStorageConnectorDetails = await fetchConnectorDetails(serviceDoc?.connectors?.file?._id);
		logger.trace(`File Storage Connector document :: ${JSON.stringify(fileStorageConnectorDetails)}`);

		let dataStorageConnectorDetails = await fetchConnectorDetails(serviceDoc?.connectors?.data?._id);
		logger.trace(`Data Storage Connector document :: ${JSON.stringify(dataStorageConnectorDetails)}`);


		if (dataStorageConnectorDetails?.type === 'MONGODB') {
			serviceDoc.connectors.data.type = 'MONGODB';
			serviceDoc.connectors.data.Mongo = dataStorageConnectorDetails.values;
		}


		if (fileStorageConnectorDetails?.type === 'GRIDFS') {
			serviceDoc.connectors.file.type = 'GRIDFS';
			serviceDoc.connectors.file.Mongo = fileStorageConnectorDetails.values;

		} else if (fileStorageConnectorDetails?.type === 'AZBLOB') {
			serviceDoc.connectors.file.type = 'AZBLOB';
			serviceDoc.connectors.file.AZURE = fileStorageConnectorDetails.values;

		} else if (fileStorageConnectorDetails?.type === 'S3') {
			serviceDoc.connectors.file.type = 'S3';
			serviceDoc.connectors.file.S3 = fileStorageConnectorDetails.values;

		} else if (fileStorageConnectorDetails?.type === 'GCS') {
			serviceDoc.connectors.file.type = 'GCS';
			serviceDoc.connectors.file.GCS = fileStorageConnectorDetails.values;
		}


		// INIT CONFIG based on the service doc
		await initConfigVariables(serviceDoc, true);
		// FETCH GLOABL DEF
		let globalDef = await fetchGlobalDefinitions();
		fs.writeFileSync('./globalDef.json', JSON.stringify(globalDef), 'utf-8');
		logger.debug('Generated globalDef.json');
		// GENERATE THE CODE
		require('./codeGen').init(serviceDoc);
		// CONNECT TO APPCENTER DB
		await establishingAppCenterDBConnections();
		// INITIALIZE MODELS
		require('./api/models').init();
		logger.debug('Initialised mongo models.');
	} catch (e) {
		logger.error('Error in DB init!');
		logger.error(e);
		process.exit();
	}
}

async function initForWorker(additionalLoggerIdentifier) {
	logger = log4js.getLogger(global.loggerName);
	global.logger = logger;
	try {
		await establishAuthorAndLogsDBConnections();
		let serviceDoc = await fetchServiceDetails(config.serviceId);
		logger.trace(`Service document : ${JSON.stringify(serviceDoc)}`);
		// INIT CONFIG based on the service doc
		initConfigVariables(serviceDoc, false);
		config.updateLogger(additionalLoggerIdentifier);
		// FETCH GLOABL DEF
		await establishingAppCenterDBConnections();
		// INITIALIZE MODELS
		require('./api/models').init();
		logger.debug('Initialised mongo models.');
	} catch (e) {
		logger.error('Error in DB init!');
		logger.error(e);
		process.exit();
	}
}

module.exports = {
	init,
	initForWorker
};