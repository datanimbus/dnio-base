const { parentPort, workerData } = require('worker_threads');
const _ = require('lodash');
let fs = require('fs');
var archiver = require('archiver');
const mongoose = require('mongoose');
let lineReader = require('line-reader');
const crypto = require('crypto');
const uuid = require('uuid/v1');
const moment = require('moment');
let dateFields = [];

mongoose.set('useFindAndModify', false);

const config = require('../../config');

const log4js = require('log4js');
const LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceName} v.${config.serviceVersion}] [Worker]` : `[${config.serviceName} v.${config.serviceVersion}] [Worker]`;
const LOG_LEVEL = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info';
log4js.configure({
	appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
	categories: { default: { appenders: ['out'], level: LOG_LEVEL } }
});
const logger = log4js.getLogger(LOGGER_NAME);

global.logger = logger;

require('../../db-factory');

/** 

This shall be used later when data.stack starts supporitng timezones for export.

// to do moment
function convertToTimezone(value, dateType, timezone = 0) {
    if(value) {
       try {
        const temp = new Date((new Date(value)).getTime() - (timezone * 60 * 1000));
        if(dateType == 'date'){
            return dateformat(temp, 'mmm d, yyyy');
        } else {
			return dateformat(temp, 'mmm d, yyyy, HH:MM:ss');
        }
       } catch(e) {
			logger.error(e);
       }
    }
}

*/

function convertToTimezone(dateObj, dateType, timezone = 0) {
	logger.trace(timezone);
	if(dateObj) {
		try {
			return {
				tzData : dateType == 'date' ? moment(dateObj.tzData).tz(dateObj.tzInfo).format('MMM DD, YYYY') : dateObj.tzData,
				tzInfo: dateObj.tzInfo
			};
		} catch(e) {
			logger.error(e);
		}
	}
}

function parseDateField(data, key, dateType, timezone) {
	if(data[key]) {
		if(Array.isArray(data[key])) {
			data[key] = data[key].map(dt => {
				let result = convertToTimezone(dt, dateType, timezone);
				data[key] = result.tzData;
				data[key + '-Timezone Info'] = result.tzInfo;
			});
		} else {
			let result = convertToTimezone(data[key], dateType, timezone);
			data[key] = result.tzData;
			data[key + '-Timezone Info'] = result.tzInfo;
		}
		return data;
	}
	let nestedKeys ,nextKey;
	if(key) nestedKeys =  key.split('.');
	if(nestedKeys) nextKey = nestedKeys.shift();
	if(nextKey && data[nextKey]) {
		if(Array.isArray(data[nextKey]))
			data[nextKey] = data[nextKey].map(dt => parseDateField(dt, nestedKeys.join('.'), dateType, timezone));
		if(typeof data[nextKey] == 'object')
			data[nextKey] = parseDateField(data[nextKey], nestedKeys.join('.'), dateType, timezone);
		return data;
	}
	return data;
}

function convertDateToTimezone(doc, timezone) {
	dateFields.forEach(pf => {
		// if(!timezone) {
		//     timezone = pf['defaulTimezone'] || global.defaultTimezone;
		//     timezone = moment.tz('timezone').utcOffset() * -1;
		// }
		doc = parseDateField(doc, pf['field'], pf['dateType'], timezone);
	});
	// if(doc._metadata) {
	// 	doc._metadata.createdAt = convertToTimezone(doc._metadata.createdAt, 'datetime', timezone);
	// 	doc._metadata.lastUpdated = convertToTimezone(doc._metadata.lastUpdated, 'datetime', timezone);
	// }
	return doc;
}

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

function getHeadersAsPerSelectParam(headersObj, selectOrder) {
	Object.keys(headersObj).forEach(headerKey => {
		if (!selectOrder.includes(headerKey))
			if(headerKey.endsWith('-Timezone Info')) {
				selectOrder.splice(selectOrder.indexOf(headerKey.replace('-Timezone Info', '')) + 1, 0, headerKey);
			} else {
				selectOrder.push(headerKey);
			}
	});
	return selectOrder;
}

function replaceHeaders(headers, fileHeaders) {
	Object.keys(headers).forEach(key => {
		fileHeaders = fileHeaders.replace(key, headers[key].replace(/,/g, '-'));
	});
	return fileHeaders.replace(/"/g, '');
}

function headerMapper(object, headers) {
	let MappedValue = {};
	let split = [];
	Object.keys(object).forEach(key => {
		if (key.includes('{index}')) {
			split = key.split('{index}');
			headers.forEach(header => {
				if (!isNaN(header.replace(split[0], '').replace(split[1], ''))) {
					let value = object[key].replace('{index}', header.split(split[0])[1].split('.')[0]);
					MappedValue[header] = value;
				}
			});
		}
		else {
			MappedValue[key] = object[key];
		}
	});
	return MappedValue;
}

function getCSVRow(headers, line) {
	var row = '';
	var jsonDoc = JSON.parse(line);
	headers.forEach(header => {
		row += `"${jsonDoc && jsonDoc[header] ? (jsonDoc[header] + '').replace(/"/g, '\'') : ''}",`;
	});
	return row.slice(0, -1);
}

function getRelationVF(key, value, VFArray) {
	let obj = {};
	let idInclude = false;
	VFArray.forEach(_o => {
		if (_o.key == '_id') idInclude = true;
		if (_o.properties && _o.properties._type == 'Geojson') {
			obj[key + _o.key + '.userInput'] = value + _o.name + '.userInput';
			obj[key + _o.key + '.formattedAddress'] = value + _o.name + '.formattedAddress';
			obj[key + _o.key + '.geometry.type'] = value + _o.name + '.geometry.type';
			obj[key + _o.key + '.geometry.coordinates'] = value + _o.name + '.geometry.coordinates';
			obj[key + _o.key + '.town'] = value + _o.name + '.town';
			obj[key + _o.key + '.district'] = value + _o.name + '.district';
			obj[key + _o.key + '.state'] = value + _o.name + '.state';
			obj[key + _o.key + '.pincode'] = value + _o.name + '.pincode';
			obj[key + _o.key + '.country'] = value + _o.name + '.country';
		}
		else if (_o.properties && _o.properties._type == 'File') {
			obj[key + _o.key + '._id'] = value + _o.name + '._id';
			obj[key + _o.key + '.filename'] = value + _o.name + '.filename';
			obj[key + _o.key + '.contentType'] = value + _o.name + '.contentType';
			obj[key + _o.key + '.length'] = value + _o.name + '.length';
			obj[key + _o.key + '.chunkSize'] = value + _o.name + '.chunkSize';
			obj[key + _o.key + '.uploadDate'] = value + _o.name + '.uploadDate';
			obj[key + _o.key + '.metadata.filename'] = value + _o.name + '.metadata.filename';
			obj[key + _o.key + '.md5'] = value + _o.name + '.md5';
		}
		else {
			obj[key + _o.key] = value + _o.properties.name;
		}
	});
	if (_.isEmpty(obj)) {
		obj[key + '_id'] = value + 'ID';
		obj[key + '_href'] = value + '_href';
	}
	else if (!idInclude) {
		obj[key + '_id'] = value + 'ID';
	}
	return obj;
}

function keyvalue(data, obj, keys, values, flag) {

	data.forEach(item => {
		if (item.key == '_href') {
			return;
		}
		if (keys == undefined || values == undefined) {
			keys = ''; values = '';
		}

		if (item && item['properties'] && (item['properties']['relatedTo'] || item['type'] == 'User')) {
			let newkeys = keys + item.key + '.';
			let newValues = values + item['properties']['name'] + '.';
			let newObj = getRelationVF(newkeys, newValues, item['properties'].relatedViewFields);
			Object.assign(obj, newObj);
		} else if (item['type'] == 'Object' && item['properties']) {
			keys = item.key + '.';
			values = item['properties']['name'] + '.';

			keyvalue(item.definition, obj, keys, values, flag);
			keys = '';
			values = '';
		} else if (item['type'] == 'Array' && flag) {
			if (item['definition'] && item['definition']['_self'] && item['definition']['_self']['type'] == 'Object') {
				keys += item.key + '.{index}.';
				values += item['properties']['name'] + '.{index}.';
				keyvalue(item['definition']['_self']['definition'], obj, keys, values, flag);
				keys = '';
				values = '';
			} else {
				keys += item.key + '.{index}';
				values += item['properties']['name'] + '.{index}';
				obj[keys] = values;
				keys = keys.replace(item.key + '.{index}', '');
				values = values.replace(item['properties']['name'] + '.{index}', '');
			}

		} else if (item['type'] == 'Object') {
			// do nothing
		} else if (item['properties']) {
			keys += item.key;
			values += item['properties']['name'];
			obj[keys] = values;
			if(item['properties']['dateType']) {
				obj[keys + '-Timezone Info'] = values + '-Timezone Info';  
			}
			keys = keys.replace(item.key, '');
			values = values.replace(item['properties']['name'], '');
		}
	});
	obj['_metadata.lastUpdated'] = 'Last Updated';
	obj['_metadata.createdAt'] = 'Created';
	return obj;
}

async function execute() {

	const commonUtils = require('../utils/common.utils');
	const exportUtils = require('./../utils/export.utils');
	const crudderUtils = require('./../utils/crudder.utils');
	const specialFields = require('../utils/special-fields.utils');
	dateFields = specialFields.dateFields ? specialFields.dateFields : [];

	const serviceModel = mongoose.model(config.serviceId);
	const fileTransfersModel = mongoose.model('fileTransfers');

	logger.level = LOG_LEVEL;
	let reqData = workerData.reqData;
	let fileId = workerData.fileId;
	let txnId = reqData.headers.txnid;
	const BATCH = 500;
	let select = reqData.query.select || '';
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
	select = select ? select.split(',') : [];
	let selectionObject = null;
	// let intFilter = null;
	let definitionArr;
	let obj = {};
	let obj2 = {};
	var resul = {};
	var totalRecords;

	let outputDir = './output/';
	var txtWriteStream = fs.createWriteStream(outputDir + fileName + '.txt');
	let headersObj = {};
	let serviceDetailsObj = {};
	let cursor;

	try {
		let serviceDetails = require('./../../service.json');
		definitionArr = _.cloneDeep(serviceDetails.definitionWithId);
		var cbc = keyvalue(definitionArr, obj, null, null, false);
		var mapping = keyvalue(definitionArr, obj2, null, null, true);

		if (select.length > 0 && select[0][0] !== '-') {
			resul['_id'] = cbc['_id'];
			for (let i = 0; i < select.length; i++) {
				resul[select[i]] = cbc[select[i]];
			}
		}
		else if (select.length > 0 && select[0][0] === '-') {
			for (let i = 0; i < select.length; i++) {
				var unsignedKey = select[i].slice(1);
				delete cbc[unsignedKey];
			}
			resul = cbc;
		}
		else {
			resul = cbc;
		}
		if (select && select.length === 0 && resul) {
			select = Object.keys(resul);
		}

		selectionObject = exportUtils.getSelectionObject(serviceDetails, select);
		if (selectionObject.querySelect.length > 0) {
			reqData.query.select = selectionObject.querySelect.join(',');
		}
		let filter = reqData.query.filter;
		if (filter) {
			filter = typeof filter === 'string' ? JSON.parse(filter) : filter;
			// intFilter = JSON.parse(JSON.stringify(filter));
			filter = await exportUtils.createFilter(definitionArr, filter, reqData);
			filter = commonUtils.modifySecureFieldsFilter(filter, specialFields.secureFields,false);
			filter = crudderUtils.parseFilter(filter);
		}
		logger.debug(`[${txnId}] Filter for export :: ${JSON.stringify(filter)}`);

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
			logger.debug(`[${txnId}] : Running batch :: ${i + 1}`);
			var documents = [];
			for (var j = 0; j < BATCH; j++) {
				let doc = await cursor.next();
				if (doc) documents.push(doc);
				else break;
			}
			logger.trace(`[${txnId}] : Fethed Documents from cursor for batch :: `, i + 1);

			/******** Expanding Relation Fields *******/
			documents = await exportUtils.expandInBatch(documents, selectionObject, i, fileName, reqData, resul, serviceDetailsObj, { forFile: true });
			logger.trace(`[${txnId}] : Expanded Documents for batch :: `, i + 1);

			/******** Decrypting Secured Fields *******/
			documents = await specialFields.secureFields.reduce((acc, curr) => acc.then(_d => commonUtils.decryptArrData(_d, curr, true)), Promise.resolve(documents));
			logger.trace(`[${txnId}] : Decrypted Documents for batch :: `, i + 1);

			/*********** Formating Date Fields ************/
			documents = documents.map(doc => convertDateToTimezone(doc, 0));

			/***** Converting Date Fields To Given Timezone *****/
			// documents = documents.map(doc => convertDateToTimezone(doc, timezone));

			/******** Flatenning documents to write in TXT file *******/
			documents = documents.map(doc => flatten(doc, true));
			logger.trace(`[${txnId}] : Flattened Documents for batch :: `, i + 1);

			/******** Writing documents in TXT file *******/
			await documents.reduce((acc, curr) => {
				Object.assign(headersObj, curr);
				return acc.then(() => txtWriteStream.write(JSON.stringify(curr) + '\n', () => Promise.resolve()));
			}, Promise.resolve());


		}, Promise.resolve());

		/********** Preparing file headers  *********/
		logger.debug(`[${txnId}] : Txt file is ready. Creating CSV...`);
		let headers = getHeadersAsPerSelectParam(headersObj, select);
		let fileHeaders = replaceHeaders(headerMapper(mapping, headers), headers.join());
		logger.debug(`[${txnId}] : headers::: `, headers);
		logger.debug(`[${txnId}] :fileHeaders::: `, fileHeaders);
		var readStream = fs.createReadStream(outputDir + fileName + '.txt');
		var csvWriteStream = fs.createWriteStream(outputDir + fileName + '.csv');
		csvWriteStream.write(fileHeaders + '\n');

		/******** Praparing CSV file from TXT file *******/
		await new Promise((resolve) => {
			lineReader.eachLine(readStream, (line, last) => {
				csvWriteStream.write(getCSVRow(headers, line) + '\n');
				if (last) {
					csvWriteStream.end();
					logger.debug(`[${txnId}] : CSV file is ready. Creating zip...`);
					resolve();
				}
			});
		});

		/******* Praparing ZIP file from CSV file ******/
		await new Promise((resolve, reject) => {
			let archive = archiver('zip', {
				zlib: { level: 9 } // Sets the compression level.
			});
			let zipWriteStream = fs.createWriteStream(outputDir + downloadFile);
			zipWriteStream.on('close', function () {
				logger.debug(`[${txnId}] : Zip file has been created. Uploading to mongo...`);
				resolve();
			});
			archive.pipe(zipWriteStream);
			archive.file(outputDir + fileName + '.csv', { name: fileName + '.csv' });
			archive.finalize();
			archive.on('error', (err) => {
				logger.error(`[${txnId}] : Error in creating zip file: `, err);
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
					logger.error(`[${txnId}] : Error in uplaoding zip to GFS bucket : `, error);
					await fileTransfersModel.updateOne({ _id: fileId }, { $set: { status: 'Error', '_metadata.lastUpdated': new Date() } });
					reject({
						_id: fileId,
						status: 'Error',
						userId: reqData.headers['user'],
						totalRecords: totalRecords
					});
				}).on('finish', async function () {
					logger.info(`[${txnId}] : Uploaded file to mongo : `, fileId);
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
		logger.error(`[${txnId}] : Error in export execute :: `, e);
		throw e;
	} finally {
		try {
			if (cursor) cursor.close();
		} catch (e) { logger.error('Error in closing cursor :: ', e); }
		mongoose.disconnect();

		/****** Removing txt, csv and zip files if exist ******/
		let filesToRemove = [outputDir + fileName + '.txt', outputDir + fileName + '.csv', outputDir + downloadFile];
		filesToRemove.forEach(file => {
			if (fs.existsSync(file)) {
				fs.unlink(file, (err) => {
					if (err) logger.error('Error in deleting file: ' + file, err);
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