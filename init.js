const fs = require('fs');
const path = require('path');
const log4js = require('log4js');
const mongoose = require('mongoose');
const _ = require('lodash');
const cron = require('node-cron');
const storageEngine = require('@appveen/data.stack-utils').storageEngine;

const config = require('./config');
const httpClient = require('./http-client');
const controller = require('./api/utils/common.utils');
const serviceDetails = require('./service.json');

const fileFields = serviceDetails.fileFields;
const logger = log4js.getLogger(global.loggerName);

function init() {
	try {
		if (!fs.existsSync(path.join(process.cwd(), 'hooks.json'))) {
			fs.writeFileSync(path.join(process.cwd(), 'hooks.json'), '{"preHooks":[],"experienceHooks":[],"wizard":[],"webHooks":[],"workflowHooks":[]}', 'utf-8');
		}
	} catch (e) {
		logger.error(e);
	}
	return controller.fixSecureText()
		.then(() => informSM())
		.then(() => GetKeys());
}

function setDefaultTimezone() {
	try {
		let authorDB = mongoose.connections[1].client.db(config.authorDB);
		authorDB.collection('userMgmt.apps').findOne({ _id: config.app })
			.then(_d => {
				if (!_d) {
					logger.error(`Timezone of ${config.app} :: Unable to find ${config.app}`);
					return;
				}
				logger.trace(`Timezone of ${config.app} :: data :: ${JSON.stringify(_d)}`);
				if (!_d.defaultTimezone) {
					logger.info(`Timezone of ${config.app} :: Not set, switching to data.stack default config`);
					global.defaultTimezone = config.dataStackDefaultTimezone;
					logger.info(`Timezone of ${config.app} :: Set as ${config.dataStackDefaultTimezone}`);
					return;
				}
				global.defaultTimezone = _d.defaultTimezone;
				logger.info(`Timezone of ${config.app} :: Set as ${global.defaultTimezone}`);
			});
	} catch (err) {
		logger.error(`Timezone of ${config.app} :: ${err.message}`);
	}
}
setDefaultTimezone();

function getFileNames(doc, field) {
	if (!doc) return [];
	let fArr = field.split('.');
	if (fArr.length === 1) {
		if (Array.isArray(doc[fArr])) {
			return doc[fArr].map(_d => _d.filename);
		} else if (doc[fArr] && typeof doc[fArr] === 'object') {
			return [doc[fArr]['filename']];
		}
	}
	let key = fArr.shift();
	if (doc && doc[key]) {
		if (Array.isArray(doc[key])) {
			let arr = doc[key].map(_d => {
				return getFileNames(_d, fArr.join('.'));
			});
			return [].concat.apply([], arr);
		}
		else if (doc[key] && typeof doc[key] === 'object') {
			return getFileNames(doc[key], fArr.join('.'));
		}
	}
}

function startCronJob() {
	cron.schedule('15 2 * * *', clearUnusedFiles);
}
startCronJob();

async function clearUnusedFiles() {
	const batch = 1000;
	const storage = config.fileStorage.storage;
	logger.info('Cron triggered to clear unused file attachment');
	logger.info(`Storage Enigne - ${config.fileStorage.storage}`);
	const datefilter = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
	const count = await mongoose.connection.db.collection(`${config.serviceCollection}.files`).count({ 'uploadDate': { '$lte': datefilter } }, { filename: 1 });
	let arr = [];
	let totalBatchCount = count / batch;
	for (let i = 0; i < totalBatchCount; i++) {
		arr.push(i);
	}
	async function reduceHandler(acc, curr, i) {
		try {
			await acc;
			let docs = await mongoose.connection.db.collection(`${config.serviceCollection}.files`).find({ 'uploadDate': { '$lte': datefilter } }, { filename: 1 }).limit(batch).skip(i * batch).toArray();
			let allFilename = docs.map(_d => _d.filename);
			let fileInUse = [];
			docs = await mongoose.model(`${config.serviceId}`).find({}, fileFields.join(' '));
			docs.forEach(_d => {
				fileFields.forEach(_k => {
					fileInUse = fileInUse.concat(getFileNames(_d, _k));
				});
			});
			docs = await global.logsDB.collection(`${config.app}.${config.serviceCollection}.audit`).find({ 'data.old': { $exists: true } }, 'data').toArray();
			docs.forEach(_d => {
				if (_d.data && _d.data.old) {
					fileFields.forEach(_k => {
						fileInUse = fileInUse.concat(getFileNames(_d.data.old, _k));
					});
				}
			});
			fileInUse = fileInUse.filter(_f => _f);
			logger.info({ fileInUse });
			let filesToBeDeleted = _.difference(allFilename, fileInUse);
			logger.info({ filesToBeDeleted });

			let promise;
			if (storage === 'GRIDFS') {
				promise = filesToBeDeleted.map(_f => deleteFileFromDB(_f));
			} else if (storage === 'AZURE') {
				promise = filesToBeDeleted.map(_f => {
					logger.info(`Deleting file - ${_f}`);
					let data = {};
					data.filename = _f;
					data.connectionString = config.fileStorage[storage].connectionString;
					data.containerName = config.fileStorage[storage].container;

					return new Promise((resolve, reject) => {
						try {
							resolve(storageEngine.azureBlob.deleteFile(data));
						} catch (err) {
							reject(err);
						}
					})
						.then(() => {
							mongoose.connection.db.collection(`${config.serviceCollection}.files`).deleteOne({ filename: _f });
						})
						.catch(err => logger.error(`Error deleting file ${_f} from Azure Blob ${err}`));
				});
			} else {
				logger.error('External Storage type is not allowed');
				throw new Error(`External Storage ${storage} not allowed`);
			}
			
			return Promise.all(promise);
		} catch (err) {
			logger.error('Error deleting unused files from DB');
		}
	}
	return arr.reduce(reduceHandler, Promise.resolve());
}

function deleteFileFromDB(filename) {
	let gfsBucket = global.gfsBucket;
	return new Promise((resolve, reject) => {
		gfsBucket.find({
			filename: filename
		}).toArray(function (err, result) {
			if (err) {
				logger.error(err);
				reject(err);
			} else {
				gfsBucket.delete(result[0]._id, function (err) {
					if (err) {
						logger.error(err);
						return reject(err);
					} else {
						logger.info('Removed file ' + filename);
						resolve(filename);
					}
				});
			}
		});
	});
}

async function informSM() {
	logger.trace('Ping SM service');
	const options = {
		url: config.baseUrlSM + '/service/' + config.serviceId + '/statusChange',
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		qs: {
			status: 'Active'
		},
		json: true
	};
	return httpClient.httpRequest(options).then(res => {
		if (res.statusCode === 200) {
			let maintenanceInfo = null;
			const body = res.body;
			logger.trace('SM status change api response :: ', JSON.stringify(body));
			if (body.status == 'Maintenance') {
				logger.info('Service going into maintenance mode!');
				logger.info(`Maintenance mode :: data :: ${JSON.stringify(maintenanceInfo)}`);
				global.status = 'Maintenance';
				if (body.maintenanceInfo) {
					maintenanceInfo = JSON.parse(body.maintenanceInfo);
					let type = maintenanceInfo.type;
					logger.info(`Maintenance type :: ${type}`);
					if (type == 'purge') {
						logger.info(`Maintenance mode :: related service :: ${JSON.stringify(body.relatedService)}`);
						return controller.bulkDelete(body.relatedService);
					}
				}
			}
			if (body.outgoingAPIs) {
				logger.trace(`Outgoing APIs - ${JSON.stringify({ outgoingAPIs: body.outgoingAPIs })}`);
				global.outgoingAPIs = body.outgoingAPIs;
			}
		} else {
			throw new Error('Service not found');
		}
	}).catch(err => {
		logger.error(`Error pinging service-manager :: ${err.message}`);
	});
}


async function GetKeys() {
	try {
		logger.trace('Ping USER service');
		const options = {
			url: config.baseUrlUSR + '/' + config.app + '/keys',
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
			},
			json: true
		};
		const res = await httpClient.httpRequest(options);
		if (res.statusCode === 200) {
			const body = res.body;
			global.baseKey = body.baseKey;
			global.baseCert = body.baseCert;
			global.encryptionKey = body.encryptionKey;
			logger.trace('Found Keys', body);
		} else {
			throw new Error('Service not found');
		}
	} catch (err) {
		logger.error(`Error pinging service-manager :: ${err.message}`);
	}
}
module.exports = init;