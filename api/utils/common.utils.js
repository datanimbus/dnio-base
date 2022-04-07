const request = require('request');
const mongoose = require('mongoose');
const log4js = require('log4js');
const crypto = require('crypto');
const _ = require('lodash');

const config = require('../../config');
const queueMgmt = require('../../queue');
const httpClient = require('../../http-client');
const secUtils = require('../utils/security.utils');

const logger = log4js.getLogger(global.loggerName);
const client = queueMgmt.client;
const serviceCache = global.serviceCache;
const documentCache = global.documentCache;
var moment = require('moment-timezone');
const e = {};

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {string} serviceId The Service ID for whose docs needs to be searched
 * @param {*} filter The filter to search docs
 */
async function getDocumentIds(req, serviceId, filter) {
	let service = serviceCache.get(serviceId);
	let document;
	if (!service) {
		service = httpClient.httpRequest({
			url: config.baseUrlSM + '/service/' + serviceId + `?app=${config.app}`,
			method: 'GET',
			headers: {
				'txnId': req ? req.headers[global.txnIdHeader] : '',
				'user': req ? req.headers[global.userHeader] : '',
				'authorization': req ? req.headers.authorization || req.headers.Authorization : '',
				'Content-Type': 'application/json'
			},
			qs: {
				select: 'api,app,definition,attributeList,collectionName'
			},
			json: true
		}).then(res => res.body);
		serviceCache.set(serviceId, service);
	}
	service = await service;
	let api = config.baseUrlGW + '/api/c/' + service.app + service.api;
	if (!document) {
		document = httpClient.httpRequest({
			url: api,
			method: 'GET',
			headers: {
				'txnId': req ? req.headers[global.txnIdHeader] : '',
				'authorization': req ? req.headers.authorization || req.headers.Authorization : '',
				'Content-Type': 'application/json'
			},
			qs: {
				count: -1,
				select: '_id',
				filter: JSON.stringify(filter)
			},
			json: true
		}).then(res => Array.isArray(res.body) ? res.body.map(e => e._id) : []);
	}
	return await document;
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} userId User Id used in relation
 */
async function getUserDoc(req, userId) {
	let key = 'USER_' + userId + '_' + req.headers[global.userHeader];
	let user = documentCache.get(key);
	const userUrl = `/api/a/rbac/${config.app}/user/${userId}`;
	logger.debug(`getUserDoc :: User URL : ${userUrl}`);
	try {
		if (!user) {
			user = await httpClient.httpRequest({
				url: `${config.baseUrlUSR}/${config.app}/user/${userId}`,
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'TxnId': req ? req.headers[global.txnIdHeader] : '',
					'User': req ? req.headers[global.userHeader] : '',
					'Authorization': req ? req.headers.authorization || req.headers.Authorization : '',
				},
				json: true
			}).then(res => {
				const temp = res.body;
				temp._href = userUrl;
				return temp;
			});
			documentCache.set(key, user);
		}
		return user;
	} catch (err) {
		logger.error(`[${req.headers[global.txnIdHeader]}] : Error in getUserDoc :: `, err.message);
		if (err.message && err.message.includes(404))
			throw new Error(`${userId} User not found.`);
		throw err;
	}
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {string} serviceId The Service ID for whose docs needs to be fetched
 * @param {string} documentId The Document ID that needs to be fetched
 */
async function getServiceDoc(req, serviceId, documentId, throwError) {
	const expandLevel = (req.headers['Expand-Level'] || 0) + 1;
	const key = serviceId + '_' + documentId + '_' + req.headers[global.userHeader];
	let service = serviceCache.get(serviceId);
	let document = documentCache.get(key);
	try {
		if (!service) {
			service = httpClient.httpRequest({
				url: `${config.baseUrlSM}/${config.appNamespace}/service/${serviceId}/?app=${config.app}`,
				method: 'GET',
				headers: {
					'TxnId': req ? req.headers[global.txnIdHeader] : '',
					'User': req ? req.headers[global.userHeader] : '',
					'Authorization': req ? req.headers.authorization || req.headers.Authorization : '',
					'Content-Type': 'application/json'
				},
				qs: {
					select: 'api,app,definition,attributeList,collectionName'
				},
				json: true
			}).then(res => res.body);
			serviceCache.set(serviceId, service);
		}
		service = await service;
		const dataServiceUrl = '/api/c/' + service.app + service.api + '/' + documentId;
		let api = config.baseUrlGW + dataServiceUrl + '?expand=true';
		// if (expandLevel < 2) {
		//     api += '?expand=true';
		// }
		if (!document) {
			document = await httpClient.httpRequest({
				url: api,
				method: 'GET',
				headers: {
					'TxnId': req ? req.headers[global.txnIdHeader] : '',
					'Authorization': req ? req.headers.authorization || req.headers.Authorization : '',
					'Content-Type': 'application/json',
					'Expand-Level': expandLevel
				},
				json: true
			}).then(res => {
				const temp = res.body;
				temp._href = dataServiceUrl;
				return temp;
			}).catch(err => {
				logger.error('Error in getServiceDoc.DocumentFetch :: ', err.statusCode, err.error);
				logger.trace(err);
				if (throwError) {
					throw err;
				} else {
					return null;
				}
			});
			documentCache.set(key, document);
		}
		return document;
	} catch (e) {
		logger.error('Error in getServiceDoc :: ', e.message);
		if (throwError) {
			throw e;
		} else {
			return null;
		}
	}
}

// /**
//  * 
//  * @param {*} req The Incoming Request Object
//  * @param {*} data The data to encrypt
//  */
// async function encryptText(req, data) {
// 	data = data.toString();
// 	var options = {
// 		url: config.baseUrlSEC + '/enc/' + config.app + '/encrypt',
// 		method: 'POST',
// 		headers: {
// 			'TxnId': req ? req.headers[global.txnIdHeader] : '',
// 			'User': req ? req.headers[global.userHeader] : '',
// 			'Authorization': req ? req.headers.authorization : '',
// 			'Content-Type': 'application/json',
// 		},
// 		body: { data },
// 		json: true
// 	};
// 	try {
// 		const res = await httpClient.httpRequest(options);
// 		if (!res) {
// 			logger.error(`[${req.headers[global.txnIdHeader]}] Security service down`);
// 			throw new Error('Security service down');
// 		}
// 		if (res.statusCode === 200) {
// 			return {
// 				value: res.body.data,
// 				checksum: crypto.createHash('md5').update(data).digest('hex')
// 			};
// 		} else {
// 			logger.error(`[${req.headers[global.txnIdHeader]}] Error response code from security service :: `, res.statusCode);
// 			logger.error(`[${req.headers[global.txnIdHeader]}] Error response from security service :: `, res.body);
// 			throw new Error('Error encrypting text');
// 		}
// 	} catch (e) {
// 		logger.error(`[${req.headers[global.txnIdHeader]}] Error requesting Security service`, e);
// 		throw e;
// 	}
// }

// /**
//  * 
//  * @param {*} req The Incoming Request Object
//  * @param {*} data The data to decrypt
//  */
// async function decryptText(req, data) {
// 	if (!data) {
// 		data = req;
// 		req = undefined;
// 	}
// 	var options = {
// 		url: config.baseUrlSEC + '/enc/' + config.app + '/decrypt',
// 		method: 'POST',
// 		headers: {
// 			'TxnId': req ? req.headers[global.txnIdHeader] : '',
// 			'User': req ? req.headers[global.userHeader] : '',
// 			'Authorization': req ? req.headers.authorization : '',
// 			'Content-Type': 'application/json',
// 		},
// 		body: { data },
// 		json: true
// 	};
// 	try {
// 		const res = await httpClient.httpRequest(options);
// 		if (!res) {
// 			logger.error(`[${req.headers[global.txnIdHeader]}] Security service down`);
// 			throw new Error('Security service down');
// 		}
// 		if (res.statusCode === 200) {
// 			return res.body.data;
// 		} else {
// 			throw new Error('Error decrypting text');
// 		}
// 	} catch (e) {
// 		logger.error(`[${req ? req.headers[global.txnIdHeader] : ''}] Error requesting Security service :: `, e.message ? e.message : (e.body ? e.body : e));
// 		throw e;
// 	}
// }


/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} data The data to encrypt
 */
async function encryptText(req, data) {
	data = data.toString();
	try {
		const res = await secUtils.encryptText(data);
		return {
			value: res.body.data,
			checksum: secUtils.md5(data)
		};
	} catch (e) {
		logger.error(`[${req.headers[global.txnIdHeader]}] Error requesting Security service`, e);
		throw e;
	}
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} data The data to decrypt
 */
async function decryptText(req, data) {
	if (!data) {
		data = req;
		req = undefined;
	}
	try {
		const res = await secUtils.decryptText(data);
		return res.body.data;
	} catch (e) {
		logger.error(`[${req ? req.headers[global.txnIdHeader] : ''}] Error requesting Security service :: `, e.message ? e.message : (e.body ? e.body : e));
		throw e;
	}
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {string} path The Path for Geojson type field
 * @param {string} address The details of user input to search for
 */
async function getGeoDetails(req, path, address) {
	address = typeof address === 'string' ? address : address.userInput;
	const options = {
		url: 'https://maps.googleapis.com/maps/api/geocode/json',
		method: 'GET',
		json: true,
		qs: {
			address,
			key: config.googleKey
		}
	};
	try {
		const res = await httpClient.httpRequest(options);
		if (!res) {
			logger.error(`[${req.headers[global.txnIdHeader]}] Google API service is down`);
			throw new Error('Google API service is down');
		}
		if (res.statusCode === 200) {
			const body = res.body;
			const geoObj = {};
			geoObj.geometry = {};
			geoObj.geometry.type = 'Point';
			geoObj.userInput = address;
			let aptLocation = null;
			if (_.isEmpty(body.results[0])) {
				return { key: path, geoObj: { userInput: address } };
			} else {
				aptLocation = !_.isEmpty(body.results) && !_.isEmpty(body.results[0]) ? body.results[0] : null;
				const typeMapping = {
					'locality': 'town',
					'administrative_area_level_2': 'district',
					'administrative_area_level_1': 'state',
					'postal_code': 'pincode',
					'country': 'country'
				};
				if (aptLocation) {
					const addrComp = aptLocation.address_components;
					Object.keys(typeMapping).forEach(key => {
						const temp = addrComp.find(comp => comp.types && comp.types.indexOf(key) > -1);
						if (temp) geoObj[typeMapping[key]] = temp.long_name;
					});
					geoObj.geometry.coordinates = [aptLocation.geometry.location.lng, aptLocation.geometry.location.lat];
					geoObj.formattedAddress = aptLocation.formatted_address;
				}
				const resObj = {};
				resObj.key = path;
				resObj.geoObj = geoObj;
				return resObj;
			}
		} else {
			logger.error(`[${req.headers[global.txnIdHeader]}] Goolgle Maps API returned 400`, res.body.error_message);
			return { key: path, geoObj: { userInput: address } };
		}
	} catch (e) {
		logger.error(`[${req.headers[global.txnIdHeader]}] Error requesting Goolgle Maps API :: `, e.message);
		throw e;
	}
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} data The data to send through socket
 */
async function informThroughSocket(req, data) {
	let txnId = req.headers[global.txnIdHeader];
	var options = {
		url: config.baseUrlGW + '/gw/fileStatus/import',
		method: 'PUT',
		headers: {
			'TxnId': req ? req.headers[global.txnIdHeader] : '',
			'User': req ? req.headers[global.userHeader] : '',
			'Authorization': req ? req.headers.authorization || req.headers.Authorization : '',
			'Content-Type': 'application/json',
		},
		json: true,
		body: data
	};
	logger.trace(`[${txnId}] Update GW :: File import status :: ${JSON.stringify({ options })}`);
	return httpClient.httpRequest(options);
}

function isExpandAllowed(req, path) {
	const select = req.query.select;
	if (!select) {
		return false;
	}
	return select.indexOf(path) > -1;
}


async function upsertDocument(req, serviceId, document) {
	let service = serviceCache.get(serviceId);
	try {
		if (!service) {
			service = httpClient.httpRequest({
				url: config.baseUrlSM + '/service/' + serviceId + `?app=${config.app}`,
				method: 'GET',
				headers: {
					'txnId': req ? req.headers[global.txnIdHeader] : '',
					'user': req ? req.headers[global.userHeader] : '',
					'authorization': req ? req.headers.authorization || req.headers.Authorization : '',
					'Content-Type': 'application/json'
				},
				qs: {
					select: 'api,app,definition,attributeList,collectionName'
				},
				json: true
			}).then(res => res.body);
			serviceCache.set(serviceId, service);
		}
		service = await service;
		const dataServiceUrl = '/api/c/' + service.app + service.api;
		let method = 'POST';
		let api = config.baseUrlGW + dataServiceUrl;
		if (document._id) {
			method = 'PUT';
			api = config.baseUrlGW + dataServiceUrl + '/' + document._id + '?upsert=true';
		}
		const doc = await httpClient.httpRequest({
			url: api,
			method: method,
			headers: {
				'txnId': req ? req.headers[global.txnIdHeader] : '',
				'authorization': req ? req.headers.authorization || req.headers.Authorization : '',
				'Content-Type': 'application/json',
			},
			json: true,
			body: document
		}).then(res => {
			const temp = res.body;
			temp._href = dataServiceUrl;
			return temp;
		});
		return doc;
	} catch (e) {
		logger.error('Error in upsertDocument :: ', e);
		throw e;
	}
}

e.getServiceDetail = function (serviceId, req) {
	var options = {
		url: config.baseUrlSM + '/' + config.app + '/service/' + serviceId + '?select=port,api,relatedSchemas,app,preHooks&app=' + config.app,
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'TxnId': req.headers ? req.headers[global.txnIdHeader] : '',
			'Authorization': req.headers ? req.headers.authorization || req.headers.Authorization : ''
		},
		json: true
	};
	return new Promise((resolve, reject) => {
		request.get(options, function (err, res, body) {
			if (err) {
				logger.error('Error requesting service-manager normal');
				logger.error(err.message);
				reject(err);
			} else if (!res) {
				logger.error('service-manager down');
				reject(new Error('service-manager down'));
			} else {
				if (res.statusCode === 200) {
					resolve(body);
				} else {
					reject(new Error('Service not found'));
				}
			}
		});
	});
};

e.getStoredServiceDetail = function (serviceId, serviceDetailsObj, req) {
	let txnId = req.headers['txnid'];
	if (serviceDetailsObj[serviceId]) {
		return Promise.resolve(serviceDetailsObj[serviceId]);
	} else if (serviceId == 'USER') {
		return Promise.resolve();
	} else {
		var options = {
			url: `${config.baseUrlSM}/${config.appNamespace}/service/${serviceId}?select=port,api,relatedSchemas,app,preHooks,definition&app=${config.app}`,
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				'TxnId': txnId,
				'Authorization': req.headers['authorization'] || req.headers['Authorization']
			},
			json: true
		};
		return new Promise((resolve, reject) => {
			//logger.debug('Requesting SM');
			request.get(options, function (err, res, body) {
				if (err) {
					logger.error(`[${txnId}] Error requesting service-manager in stored`);
					logger.error(err.message);
					reject(err);
				} else if (!res) {
					logger.error(`[${txnId}] service-manager service down`);
					reject(new Error('service-manager service down'));
				} else {
					if (res.statusCode === 200) {
						serviceDetailsObj[serviceId] = body;
						resolve(body);
					} else {
						reject(new Error('Service not found'));
					}
				}
			});
		});
	}
};

e.bulkDelete = function (relatedService) {
	const DELETEBATCH = 30;
	let rmDocs = [];
	let ids = [];
	return mongoose.connection.db.collection(config.serviceCollection).find({}).toArray()
		.then(docs => {
			let arr = [];
			docs.map(doc => ids.push(doc._id));
			let totalBatches = docs.length / DELETEBATCH;
			for (let i = 0; i < totalBatches; i++) {
				arr.push(i);
			}
			return arr.reduce((_p, curr, i) => {
				return _p
					.then(() => {
						let doc = docs.slice(i * DELETEBATCH, (i + 1) * DELETEBATCH);
						let removePromise = doc.map(doc => removeDocument(doc, relatedService));
						return Promise.all(removePromise);
					})
					.then(data => {
						data.map(doc => rmDocs.push(doc));
					});
			}, Promise.resolve());
		}).then(() => {
			var collectionsToDrop = ['bulkCreate', 'exportedFile.chunks', 'exportedFile.files', 'exports', 'fileImport.chunks', 'fileImport.files', 'fileTransfers', 'workflow'];
			collectionsToDrop = collectionsToDrop.map(coll => `${config.serviceCollection}.${coll}`);
			return dropCollections(collectionsToDrop);
		}).then(() => {
			var options = {
				url: config.baseUrlSM + '/' + (process.env.DATA_STACK_APP) + '/service/utils/' + (process.env.SERVICE_ID) + '/statusChangeFromMaintenance',
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json'
				},
				json: true
			};
			return new Promise((resolve, reject) => {
				request.put(options, function (err, res, body) {
					if (err) {
						logger.error('Error requesting service-manager');
						logger.error(err.message);
						reject(err);
					} else if (!res) {
						logger.error('service-manager down');
						reject(new Error('service-manager down'));
					} else {
						if (res.statusCode === 200) {
							resolve(body);
						} else {
							reject(new Error('Service not found'));
						}
					}
				});
			});
		})
		.catch(err => {
			return err;
		});
};

function removeDocument(doc, relatedService) {
	return checkRelation(relatedService, doc)
		.then(data => {
			if (data.allowed) {
				return posthook(data)
					.then(() => {
						return mongoose.connection.db.collection(config.serviceCollection).remove({ _id: doc._id });
					})
					.then(() => {
						return removeAudit(doc);
					});
			}
		});
}

function dropCollections(collections) {
	var promises = collections.map((coll) => {
		return mongoose.connection.db.dropCollection(coll).then(() => {
			logger.debug('Dropped collection :: ', coll);
		}).catch((err) => {
			logger.error(`Error dropping collection :: ${coll} : `, err);
		});
	});
	return Promise.all(promises);
}

function getRelationCheckObj(obj) {
	return mongoose.connection.db.collection(obj.app).find(JSON.parse(obj.filter)).toArray()
		.then(data => {
			let retObj = JSON.parse(JSON.stringify(obj));
			retObj.documents = data;
			return retObj;
		});
}

function checkRelation(relatedServices, doc) {
	let promiseArr = [];
	let inService = [];
	let result = { 'allowed': true, 'relObj': {}, id: doc._id };
	relatedServices.forEach(relatedService => {
		let urlSplit = relatedService.uri.split('/')[2];
		relatedService.app = urlSplit.split('?')[0];
		let filter = urlSplit.split('?')[1].split('=')[1];
		relatedService.filter = filter.replace('{{id}}', doc._id);
		inService.push(relatedService);
		promiseArr.push(getRelationCheckObj(relatedService));
	});
	return Promise.all(promiseArr)
		.then((_relObj) => {
			result.relObj = _relObj;
			if (_relObj && _relObj.length === inService.length) {
				_relObj.forEach(_o => {
					if (_o.documents.length !== 0 && _o.isRequired) {
						result.allowed = false;
					}
				});
			} else {
				result.allowed = false;
			}
			return result;
		});
}

function posthook(data) {
	let updateList = [];
	let promise = [];
	data.relObj.forEach(_o => {
		_o.documents.forEach(_oDoc => {
			let filter = _o.uri.split('?')[1].split('filter=')[1].split('&')[0];
			filter = JSON.parse(_o.filter);
			let ulObj = updateList.find(_ul => _ul.serviceId === _o.service && _ul.doc._id === _oDoc._id);
			if (ulObj) {
				ulObj.doc = e.generateDocumentObj(filter, ulObj.doc, data.id);
			} else {
				updateList.push({ serviceId: _o.service, doc: e.generateDocumentObj(filter, _oDoc, data.id), app: _o.app });
			}
		});
	});
	updateList.forEach(ulObj => {
		let id = ulObj.doc._id;
		delete ulObj.doc._id;
		promise.push(mongoose.connection.db.collection(ulObj.app).findOneAndUpdate({ '_id': id }, { $set: ulObj.doc }, { upsert: true }));
	});
	return Promise.all(promise);
}

function getPathFromFilter(filter, path) {
	if (typeof filter == 'string') {
		return path;
	}
	let key = Object.keys(filter)[0];
	if (key == '_id') return path;
	if (key == '$elemMatch') return getPathFromFilter(filter[key], path);
	else return getPathFromFilter(filter[key], path == '' ? key : (path + `.${key}`));
}

function removeExtIds(path, doc, id) {
	let pathArr = path.split('.');
	let key = pathArr.shift();
	if (!doc || !doc[key]) return doc;
	if (pathArr.length == 0) {
		if (Array.isArray(doc[key])) {
			doc[key] = doc[key].filter(_d => _d._id != id);
		} else {
			if (doc[key] && doc[key]._id == id)
				doc[key] = null;
		}
	} else {
		if (Array.isArray(doc[key])) {
			doc[key] = doc[key].map(_d => removeExtIds(pathArr.join('.'), _d, id));
		}
		doc[key] = removeExtIds(pathArr.join('.'), doc[key], id);
	}
	return doc;
}

e.generateDocumentObj = function (filter, obj, docId) {
	let path = getPathFromFilter(filter, '');
	if (path.substr(-4) == '._id') path = path.substr(0, path.length - 4);
	return removeExtIds(path, obj, docId);
};


function removeAudit(doc) {
	let auditData = {};
	auditData.id = doc._id;
	auditData.colName = 'def2406.audit';
	client.publish('auditQueueRemove', JSON.stringify(auditData));
}

let secureFields = ''.split(',');

function decryptSecureData(d) {
	var options = {
		url: config.baseUrlSEC + `/enc/${config.app}/decrypt`,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: { data: d },
		json: true
	};
	return new Promise((resolve, reject) => {
		request.post(options, function (err, res, body) {
			if (err) {
				logger.error('Error requesting Security service');
				reject(err);
			} else if (!res) {
				logger.error('Security service down');
				reject(new Error('Security service down'));
			}
			else {
				if (res.statusCode === 200) {
					let obj = {
						//value: d,
						value: d.toString(),
						checksum: crypto.createHash('md5').update(body.data).digest('hex')
					};
					resolve(obj);
				} else {
					logger.error('Error encrypting text');
					logger.debug('Returning previous value ' + d);
					resolve({ value: d });
					// reject(new Error('Error encrypting text'))
				}
			}
		});
	});
}

function getData(filter, page, count) {
	page = (page === 0) ? 0 : page * count;
	return mongoose.connection.db.collection(config.serviceCollection).find(filter).skip(page).limit(count).toArray();
}

function fixData(field, data) {
	let keys = field.split('.');
	if (keys.length == 1) {
		if (data[keys[0]]) {
			if (Array.isArray(data[keys[0]])) {
				let promises = data[keys[0]].map(_d => decryptSecureData(_d));
				return Promise.all(promises)
					.then(_d => {
						data[keys[0]] = _d;
						return data;
					})
					.catch(err => {
						logger.error(err);
						return data;
					});
			} else {
				return decryptSecureData(data[keys[0]])
					.then(_d => {
						data[keys[0]] = _d;
						return data;
					})
					.catch(err => {
						logger.error(err);
						return data;
					});
			}
		}
	}
	else {
		if (data[keys[0]]) {
			let ele = keys.shift();
			let newNestedKey = keys.join('.');
			if (Array.isArray(data[ele])) {
				let promises = data[ele].map(_d => fixData(newNestedKey, _d));
				return Promise.all(promises)
					.then(_d => {
						data[ele] = _d;
						return data;
					});
			}
			return fixData(newNestedKey, data[ele]).then(() => data);
		}
	}
}

function updateData(model, field, data) {
	return fixData(field, data)
		.then(() => {
			let id = data._id;
			return model.update({ _id: id }, data);
		});
}

function fixForField(field) {
	const model = mongoose.model(config.serviceId);
	let filter = { $and: [{ [field]: { $exists: true } }, { [field]: { $ne: null } }, { [`${field}.value`]: { $exists: false } }] };
	return model.count(filter)
		.then((count) => {
			if (count > 0) logger.info(`Secure text fix :: ${count} Documents found for ${field}`);
			let batchSize = 100;
			let totalBatches = count / batchSize;
			let arr = [];
			for (let i = 0; i < totalBatches; i++) {
				arr.push(i);
			}
			return arr.reduce((_p, curr) => {
				logger.info(`Secure text fix :: batch :: ${JSON.stringify(curr)}`);
				return _p
					.then(() => {
						return getData(filter, curr, batchSize);
					})
					.then(_data => _data.map(_d => updateData(model, field, _d)))
					.then(_updatePromises => Promise.all(_updatePromises));
			}, Promise.resolve());
		});
}

e.fixSecureText = function () {
	if (secureFields.join() != '') logger.info(`Fixing Secure Text. Fields - ${secureFields}`);
	return secureFields.reduce((acc, curr) => {
		return acc.then(() => {
			return fixForField(curr);
		});
	}, Promise.resolve());
};

function decryptData(data, nestedKey, forFile) {
	let keys = nestedKey.split('.');
	if (keys.length == 1) {
		if (data[keys[0]]) {
			if (Array.isArray(data[keys[0]])) {
				let promises = data[keys[0]].map(_d => {
					return decryptText(_d.value)
						.then(_decrypted => {
							if (forFile)
								_d = _decrypted;
							else
								_d.value = _decrypted;
							return _d;
						});
				});
				return Promise.all(promises)
					.then(_d => {
						data[keys[0]] = _d;
						return data;
					});
			} else if (data[keys[0]] && typeof data[keys[0]].value == 'string') {
				return decryptText(data[keys[0]].value)
					.then(_d => {
						if (forFile)
							data[keys[0]] = _d;
						else
							data[keys[0]].value = _d;
						return data;
					});
			}
		} else {
			return Promise.resolve(data);
		}
	} else {
		if (data[keys[0]]) {
			let ele = keys.shift();
			let newNestedKey = keys.join('.');
			if (Array.isArray(data[ele])) {
				let promises = data[ele].map(_d => decryptData(_d, newNestedKey, forFile));
				return Promise.all(promises)
					.then(_d => {
						data[ele] = _d;
						return data;
					});
			}
			return decryptData(data[ele], newNestedKey, forFile).then(() => data);
		} else {
			return Promise.resolve(data);
		}
	}
}

e.decryptArrData = function (data, nestedKey, forFile) {
	let promises = data.map(_d => decryptData(_d, nestedKey, forFile));
	return Promise.all(promises);
};

function getFormattedDate(txnId, dateObj, defaultTimeZone, supportedTimeZones) {
	if (_.isEmpty(dateObj)) return;
	if (dateObj.rawData) {
		if (dateObj.tzInfo && dateObj.tzInfo !== defaultTimeZone && supportedTimeZones.length && !supportedTimeZones.includes(dateObj.tzInfo))
			throw new Error('Invalid timezone value ' + dateObj.tzInfo);
		return formatDate(txnId, dateObj.rawData, dateObj.tzInfo || defaultTimeZone, false);
	} else if (dateObj.unix) {
		return formatDate(txnId, dateObj.unix, defaultTimeZone, true);
	} else {
		logger.error(`[${txnId}] Invalid dateObj in getFormattedDate :: `, dateObj);
		throw new Error('Invalid date time value');
	}
}

function formatDate(txnId, rawData, tzInfo, isUnix) {
	try {
		let parsedDate = new Date(rawData);
		if (!tzInfo) tzInfo = global.defaultTimezone;
		let dt = moment(parsedDate.toISOString());
		return {
			rawData: rawData.toString(),
			tzData: dt.tz(tzInfo).format(),
			tzInfo: tzInfo,
			utc: dt.toISOString(),
			unix: isUnix ? rawData : Date.parse(rawData)
		};
	} catch (e) {
		logger.error(`[${txnId}] Invalid data in formatDate :: ${rawData} ${tzInfo} ${isUnix}`);
		throw new Error('Invalid date time value');
	}
}

e.getGenericHeaders = () => {
	return {
		'Data-Stack-DS-Name': config.serviceName,
	};
};

e.generateHeaders = (_txnId) => {
	let headers = require('../../service.json').headers;
	let generatedHeaders = e.getGenericHeaders();
	logger.trace(`[${_txnId}] Service headers :: ${JSON.stringify(headers)}`);
	headers.forEach(_header => generatedHeaders[_header.header] = _header.value);
	logger.trace(`[${_txnId}] Generated headers :: ${JSON.stringify(generatedHeaders)}`);
	return generatedHeaders;
};

e.generateProperties = (_txnId) => {
	let headers = require('../../service.json').headers;
	let properties = {};
	logger.trace(`[${_txnId}] Service properties :: ${JSON.stringify(headers)}`);
	headers.forEach(_header => properties[_header.key] = _header.value);
	logger.trace(`[${_txnId}] Generated properties :: ${JSON.stringify(properties)}`);
	return properties;
};

function crudDocuments(_service, method, body, qs, req) {
	let HOST = _service.host;
	let PORT = _service.port;
	var options = {
		url: 'http://' + HOST + ':' + PORT + _service.uri,
		method: method.toUpperCase(),
		headers: {
			'Content-Type': 'application/json',
			'TxnId': req.headers ? req.headers['txnid'] : '',
			'Authorization': req.headers ? req.headers['authorization'] || req.headers['Authorization'] : '',
			'Cache': req.headers ? req.headers['cache'] : ''
		},
		json: true
	};
	if (body) {
		options.body = body;
	}
	if (qs) options.qs = JSON.parse(JSON.stringify(qs));

	return new Promise((resolve, reject) => {
		request[method.toLowerCase()](options, function (err, res, body) {
			if (err) {
				logger.error('Error requesting Service ' + options.url);
				logger.error(err);
				reject(new Error('Error requesting Service'));
			} else if (!res) {
				reject(new Error('Service Down'));
			} else {
				if (res.statusCode == 200) resolve(body);
				else {
					if (body && body.message)
						reject(new Error(body.message));
					else
						reject(new Error(JSON.stringify(body)));
				}
			}
		});
	});
}

function mergeCustomizer(objValue, srcValue) {
	if (_.isArray(objValue)) {
		return srcValue;
	}
}

function isValue(a) {
	return a == null || !(typeof a == 'object');
}

function isArray(a) {
	return Array.isArray(a);
}

function isEqual(a, b) {
	return (_.isEqual(a, b));
}

function getDiff(a, b, oldData, newData) {
	if (a === null || b === null) {
		Object.assign(oldData, a);
		Object.assign(newData, b);
	}
	else if (typeof a == 'object' && typeof b == 'object') {
		Object.keys(a).forEach(_ka => {
			if (typeof b[_ka] == 'undefined') {
				oldData[_ka] = a[_ka];
				newData[_ka] = null;
			} else if (isValue(a[_ka]) || isArray(a[_ka])) {
				if (!isEqual(a[_ka], b[_ka])) {
					oldData[_ka] = a[_ka];
					newData[_ka] = b[_ka];
				}
				delete b[_ka];
			} else {
				oldData[_ka] = {};
				newData[_ka] = {};
				getDiff(a[_ka], b[_ka], oldData[_ka], newData[_ka]);
				if (_.isEmpty(oldData[_ka])) delete oldData[_ka];
				if (_.isEmpty(newData[_ka])) delete newData[_ka];
				delete b[_ka];
			}
		});
		Object.keys(b).forEach(_kb => {
			oldData[_kb] = null;
			newData[_kb] = b[_kb];
		});
	}
}

function modifySecureFieldsFilter(filter, secureFields, secureFlag, isWorkflowFilter) {
	if (filter instanceof RegExp) return filter;
	let newSecurefield = secureFields.map(field => field + '.value');
	if (Array.isArray(filter)) return filter.map(_f => modifySecureFieldsFilter(_f, secureFields, secureFlag, isWorkflowFilter));
	if (filter != null && typeof filter == 'object' && filter.constructor == {}.constructor) {
		let newFilter = {};
		Object.keys(filter).forEach(_k => {
			let newKey = _k;
			if (newSecurefield.indexOf(_k) > -1 || (isWorkflowFilter && newSecurefield.indexOf(_k.substring(9)) > -1 && (_k.startsWith('data.new') || _k.startsWith('data.old')))) {
				newKey = _k.split('.');
				newKey.pop();
				newKey = newKey.join('.');
				newKey = newKey.startsWith('$') ? newKey : newKey + '.checksum';
				newFilter[newKey] = modifySecureFieldsFilter(filter[_k], secureFields, true, isWorkflowFilter);
			} else {
				newFilter[newKey] = modifySecureFieldsFilter(filter[_k], secureFields, secureFlag, isWorkflowFilter);
			}
		});
		return newFilter;
	}
	return secureFlag && typeof filter == 'string' ? crypto.createHash('md5').update(filter).digest('hex') : filter;
}

function removeNullForUniqueAttribute(obj, key) {
	let keyArr = key.split('.');
	return keyArr.reduce((acc, curr, i) => {
		if (!acc) return null;
		if (i === keyArr.length - 1 && acc[curr] === null) {
			acc[curr] = undefined;
			return acc;
		}
		return acc[curr];
	}, obj);
}

e.getDocumentIds = getDocumentIds;
e.getServiceDoc = getServiceDoc;
e.getUserDoc = getUserDoc;
e.encryptText = encryptText;
e.decryptText = decryptText;
e.getGeoDetails = getGeoDetails;
e.informThroughSocket = informThroughSocket;
e.isExpandAllowed = isExpandAllowed;
e.getFormattedDate = getFormattedDate;
e.crudDocuments = crudDocuments;
e.mergeCustomizer = mergeCustomizer;
e.getDiff = getDiff;
e.modifySecureFieldsFilter = modifySecureFieldsFilter;
e.removeNullForUniqueAttribute = removeNullForUniqueAttribute;
e.upsertDocument = upsertDocument;

module.exports = e;