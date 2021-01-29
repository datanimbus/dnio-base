const utils = require('@appveen/utils');
const request = require('request');
const mongoose = require('mongoose');
const crypto = require('crypto');
const _ = require('lodash');

const config = require('../../config');
const queueMgmt = require('../../queue');
const httpClient = require('../../http-client');
const hooksUtils = require('./hooks.utils');
const specialFields = require('./special-fields.utils');

const logger = global.logger;
const client = queueMgmt.client;
const serviceCache = global.serviceCache;
const documentCache = global.documentCache;
var moment = require('moment-timezone');
const e = {};

/**
 * @param {*} req The Incomming Request Object
 * @param {*} data The Data to simulate
 * @param {Object} [options] Other Options for simulation
 * @param {boolean} [options.generateId] Should generate new _id only for POST
 * @param {boolean} [options.simulate] Simulation Flag
 * @param {string} [options.operation] Operation for which simulate is called : POST/PUT/GET
 * @param {string} [options.trigger] Trigger for this simulate presave/submit/approve
 * @param {string} [options.docId] Document ID
 * @param {string} [options.source] Alias of trigger
 */
function simulate(req, data, options) {
    const model = mongoose.model(config.serviceId);
    if (!options) {
        options = {};
    }
    options.simulate = true;
    data = new model(data).toObject(); // Type Casting as per schema.
    let promise = Promise.resolve(data);
    let oldData;
    if (!data._id && options.generateId) {
        promise = utils.counter.generateId(config.ID_PREFIX, config.serviceCollection, config.ID_SUFFIX, config.ID_PADDING, config.ID_COUNTER).then(id => {
            data._id = id;
            return data;
        });
    } else if (data._id && options.operation == 'PUT') {
        promise = model.findOne({ _id: data._id }).lean(true).then(_d => {
            oldData = _d;
            return _.assign(JSON.parse(JSON.stringify(_d)), data);
        });
    }
    return promise.then((newData) => {
        data = newData;
        return schemaValidation(req, data, oldData).catch(err => modifyError(err, 'schema'));
    }).then((newData) => {
        data = newData;
        return hooksUtils.callAllPreHooks(req, data, options).catch(err => modifyError(err, 'preHook'));
    }).then(newData => {
        data = newData;
        return schemaValidation(req, data, oldData).catch(err => modifyError(err, 'schema'));
    }).then((newData) => {
        data = newData;
        return uniqueValidation(req, data, oldData).catch(err => modifyError(err, 'unique'));
    }).then(() => {
        return createOnlyValidation(req, data, oldData).catch(err => modifyError(err, 'createOnly'));
    }).then(() => {
        return relationValidation(req, data, oldData).catch(err => modifyError(err, 'relation'));
    }).then(() => {
        return enrichGeojson(req, data, oldData).catch(err => modifyError(err, 'geojson'));
    }).then(() => {
        return data;
    }).catch(err => {
        logger.error(err);
        throw err;
    });
}

/**
 * 
 * @param {*} err The Error Object of catch
 * @param {string} source Source of Error
 */
function modifyError(err, source) {
    const error = {};
    error.source = source;
    error.error = err;
    throw error;
}


/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function schemaValidation(req, newData, oldData) {
    const model = mongoose.model(config.serviceId);
    if (oldData) {
        newData = Object.assign(oldData, newData);
    }
    let modelData = new model(newData);
    modelData.isNew = false;
    logger.debug(JSON.stringify({ modelData }));
    try {
        const status = await modelData.validate();
        return modelData.toObject();
    } catch (e) {
        logger.error('schemaValidation', e);
        throw e;
    }
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function uniqueValidation(req, newData, oldData) {
    try {
        const errors = await specialFields.validateUnique(req, newData, oldData);
        if (errors) {
            throw errors;
        }
        return null;
    } catch (e) {
        logger.error('uniqueValidation', e);
        throw e;
    }
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function createOnlyValidation(req, newData, oldData) {
    try {
        const errors = specialFields.validateCreateOnly(req, newData, oldData, true);
        if (errors) {
            throw errors;
        }
        return null;
    } catch (e) {
        logger.error('createOnlyValidation', e);
        throw e;
    }
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function relationValidation(req, newData, oldData) {
    try {
        const errors = await specialFields.validateRelation(req, newData, oldData);
        if (errors) {
            throw errors;
        }
        return null;
    } catch (e) {
        logger.error('relationValidation', e);
        throw e;
    }
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} newData The Data to validate against schema
 * @param {*} [oldData] Old Data if PUT request
 */
async function enrichGeojson(req, newData, oldData) {
    try {
        const errors = await specialFields.enrichGeojson(req, newData, oldData);
        if (errors) {
            throw errors;
        }
        return null;
    } catch (e) {
        logger.error('enrichGeojson', e);
        throw e;
    }
}

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
            url: config.baseUrlSM + '/service/' + serviceId,
            method: 'GET',
            headers: {
                'txnId': req ? req.headers[global.txnIdHeader] : '',
                'user': req ? req.headers[global.userHeader] : '',
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
                'authorization': req ? req.headers.authorization : '',
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
 * @param {string} serviceId The Service ID for whose docs needs to be fetched
 * @param {string} documentId The Document ID that needs to be fetched
 */
async function getServiceDoc(req, serviceId, documentId) {
    const expandLevel = (req.headers['Expand-Level'] || 0) + 1;
    const key = serviceId + '_' + documentId + '_' + req.headers[global.userHeader];
    let service = serviceCache.get(serviceId);
    let document = documentCache.get(key);
    if (!service) {
        service = httpClient.httpRequest({
            url: config.baseUrlSM + '/service/' + serviceId,
            method: 'GET',
            headers: {
                'txnId': req ? req.headers[global.txnIdHeader] : '',
                'user': req ? req.headers[global.userHeader] : '',
                'Content-Type': 'application/json'
            },
            qs: {
                select: 'api,app'
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
        document = httpClient.httpRequest({
            url: api,
            method: 'GET',
            headers: {
                'txnId': req ? req.headers[global.txnIdHeader] : '',
                'authorization': req ? req.headers.authorization : '',
                'Content-Type': 'application/json',
                'Expand-Level': expandLevel
            },
            json: true
        }).then(res => {
            const temp = res.body;
            temp._href = dataServiceUrl;
            return temp;
        });
        documentCache.set(key, document);
    }
    return await document;
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} data The data to encrypt
 */
async function encryptText(req, data) {
    var options = {
        url: config.baseUrlSEC + '/enc/' + config.app + '/encrypt',
        method: 'POST',
        headers: {
            'txnId': req ? req.headers[global.txnIdHeader] : '',
            'user': req ? req.headers[global.userHeader] : '',
            'Content-Type': 'application/json',
        },
        body: { data },
        json: true
    };
    try {
        const res = await httpClient.httpRequest(options);
        if (!res) {
            logger.error('Security service down');
            throw new Error('Security service down');
        }
        if (res.statusCode === 200) {
            return {
                value: res.body.data,
                checksum: crypto.createHash('md5').update(data).digest('hex')
            };
        } else {
            throw new Error('Error encrypting text');
        }
    } catch (e) {
        logger.error('Error requesting Security service');
        throw e;
    }
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} data The data to decrypt
 */
async function decryptText(req, data) {
    var options = {
        url: config.baseUrlSEC + '/enc/' + config.app + '/decrypt',
        method: 'POST',
        headers: {
            'txnId': req ? req.headers[global.txnIdHeader] : '',
            'user': req ? req.headers[global.userHeader] : '',
            'Content-Type': 'application/json',
        },
        body: { data },
        json: true
    };
    try {
        const res = await httpClient.httpRequest(options);
        if (!res) {
            logger.error('Security service down');
            throw new Error('Security service down');
        }
        if (res.statusCode === 200) {
            return res.body.data;
        } else {
            throw new Error('Error decrypting text');
        }
    } catch (e) {
        logger.error('Error requesting Security service');
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
            logger.error('Google API service is down');
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
                        const temp = addrComp.find(comp => comp.types && comp.types.indexOf(key) > -1)
                        if (temp) geoObj[typeMapping[key]] = temp.long_name;
                    })
                    geoObj.geometry.coordinates = [aptLocation.geometry.location.lng, aptLocation.geometry.location.lat];
                }
                const resObj = {};
                resObj.key = path;
                resObj.geoObj = geoObj;
                return resObj;
            }
        } else {
            return { key: path, geoObj: { userInput: address } };
        }
    } catch (e) {
        logger.error('Error requesting Security service');
        throw e;
    }
}

/**
 * 
 * @param {*} req The Incoming Request Object
 * @param {*} data The data to send through socket
 */
async function informThroughSocket(req, data) {
    var options = {
        url: config.baseUrlGW + '/fileStatus/import',
        method: 'PUT',
        headers: {
            'txnId': req ? req.headers[global.txnIdHeader] : '',
            'user': req ? req.headers[global.userHeader] : '',
            'Content-Type': 'application/json',
        },
        json: true,
        body: data
    };
    logger.debug(JSON.stringify({ options }));
    return httpClient.httpRequest(options);
}

function isExpandAllowed(req, path) {
    const select = req.query.select;
    if (!select) {
        return false;
    }
    return select.indexOf(path) > -1;
}


e.getServiceDetail = function (serviceId, req) {
    var options = {
        url: config.baseUrlSM + '/service/' + serviceId + '?select=port,api,relatedSchemas,app,preHooks',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'TxnId': req.headers[global.txnIdHeader],
            'Authorization': req.headers.authorization
        },
        json: true
    };
    return new Promise((resolve, reject) => {
        request.get(options, function (err, res, body) {
            if (err) {
                logger.error('Error requesting service-manager normal')
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
}


e.bulkDelete = function (relatedService) {
    let document = null;
    const DELETEBATCH = 30;
    let rmDocs = [];
    let ids = [];
    return mongoose.connection.db.collection('def2406').find({}).toArray()
        .then(docs => {
            let arr = [];
            docs.map(doc => ids.push(doc._id));
            let totalBatches = docs.length / DELETEBATCH;
            for (let i = 0; i < totalBatches; i++) {
                arr.push(i);
            }
            let promise = arr.reduce((_p, curr, i) => {
                return _p
                    .then(() => {
                        let doc = docs.slice(i * DELETEBATCH, (i + 1) * DELETEBATCH);
                        let removePromise = doc.map(doc => removeDocument(doc, relatedService));
                        return Promise.all(removePromise);
                    })
                    .then(data => {
                        data.map(doc => rmDocs.push(doc));
                    })
            }, Promise.resolve());
        })
        .then(() => {
            var options = {
                url: config.baseUrlSM + '/service/' + (process.env.SERVICE_ID || 'SRVC2004') + '/statusChangeFromMaintenance',
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                json: true
            };
            return new Promise((resolve, reject) => {
                request.put(options, function (err, res, body) {
                    if (err) {
                        logger.error('Error requesting service-manager')
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
}

function removeDocument(doc, relatedService) {
    return checkRelation(relatedService, doc)
        .then(data => {
            if (data.allowed) {
                return posthook(data)
                    .then(() => {
                        return mongoose.connection.db.collection('def2406').remove({ _id: doc._id })
                    })
                    .then(() => {
                        return removeAudit(doc);
                    })
            }
        })
}

function getRelationCheckObj(obj) {
    return mongoose.connection.db.collection(obj.app).find(JSON.parse(obj.filter)).toArray()
        .then(data => {
            let retObj = JSON.parse(JSON.stringify(obj));
            retObj.documents = data;
            return retObj;
        })
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
        })
}

function posthook(data) {
    let updateList = [];
    let promise = [];
    data.relObj.forEach(_o => {
        _o.documents.forEach(_oDoc => {
            let filter = _o.uri.split('?')[1].split('filter=')[1].split('&')[0];
            filter = JSON.parse(_o.filter);
            let srvcId = Object.values(filter)[0]
            let ulObj = updateList.find(_ul => _ul.serviceId === _o.service && _ul.doc._id === _oDoc._id);
            if (ulObj) {
                ulObj.doc = e.generateDocumentObj(filter, ulObj.doc, data.id);
            } else {
                updateList.push({ serviceId: _o.service, doc: e.generateDocumentObj(filter, _oDoc, data.id), app: _o.app });
            }
        })
    })
    updateList.forEach(ulObj => {
        let id = ulObj.doc._id;
        delete ulObj.doc._id;
        promise.push(mongoose.connection.db.collection(ulObj.app).findOneAndUpdate({ '_id': id }, { $set: ulObj.doc }, { upsert: true }));
    })
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
}


function removeAudit(doc) {
    let auditData = {};
    auditData.id = doc._id;
    auditData.colName = 'def2406.audit';
    client.publish('auditQueueRemove', JSON.stringify(auditData))
};

let secureFields = ''.split(',');

function decryptSecureData(d) {
    var options = {
        url: config.baseUrlSEC + '/enc/Adam/decrypt',
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
    })
}

function getData(filter, page, count) {
    page = (page === 0) ? 0 : page * count;
    return mongoose.connection.db.collection('def2406').find(filter).skip(page).limit(count).toArray();
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
                    })
            } else {
                return decryptSecureData(data[keys[0]])
                    .then(_d => {
                        data[keys[0]] = _d;
                        return data;
                    })
                    .catch(err => {
                        logger.error(err);
                        return data;
                    })
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
                    })
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
    let updatedArr = [];
    return model.count(filter)
        .then((count) => {
            logger.debug('Documents found to be fixed for secureText field ' + field + ' ' + count);
            let batchSize = 100;
            let totalBatches = count / batchSize;
            let arr = [];
            for (let i = 0; i < totalBatches; i++) {
                arr.push(i);
            }
            return arr.reduce((_p, curr) => {
                return _p
                    .then(() => {
                        return getData(filter, curr, batchSize);
                    })
                    .then(_data => _data.map(_d => updateData(model, field, _d)))
                    .then(_updatePromises => Promise.all(_updatePromises))
            }, Promise.resolve());
        });
}

e.fixSecureText = function () {
    logger.debug('Fixing Secure Text');
    logger.debug('Fields found ' + secureFields);
    return secureFields.reduce((acc, curr) => {
        return acc.then(() => {
            return fixForField(curr);
        })
    }, Promise.resolve());
}

function decryptData(data, nestedKey) {
    let keys = nestedKey.split('.');
    if (keys.length == 1) {
        if (data[keys[0]]) {
            if (Array.isArray(data[keys[0]])) {
                let promises = data[keys[0]].map(_d => {
                    return decryptText(_d.value)
                        .then(_decrypted => {
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
                let promises = data[ele].map(_d => decryptData(_d, newNestedKey));
                return Promise.all(promises)
                    .then(_d => {
                        data[ele] = _d;
                        return data;
                    });
            }
            return decryptData(data[ele], newNestedKey).then(() => data);
        } else {
            return Promise.resolve(data);
        }
    }
}

e.decryptArrData = function (data, nestedKey) {
    let promises = data.map(_d => decryptData(_d, nestedKey));
    return Promise.all(promises);
}

function getFormattedDate(dateObj, defaultTimeZone, supportedTimeZones) {
    if(!dateObj) return;
    if(dateObj.rawData && dateObj.tzInfo) {
        if(!supportedTimeZones.includes(dateObj.tzInfo))
            throw new Error('Invalid timezone value ' + dateObj.tzInfo);
        return formatDate(rawData, dateObj.tzInfo, false);
    } else if (dateObj.rawData) {
        return formatDate(rawData, defaultTimeZone, false);
    } else if(dateObj.unix) {
        return formatDate(unix, defaultTimeZone, true);
    } else {
        throw new Error('Invalid date time value');
    }
}
function formatDate(rawData, tzInfo, isUnix) {
    parsedDate = new Date(rawData)
    let dt = moment(parsedDate.toISOString())
    try {
        return  {
            rawData: rawData.toString(),
            tzData: dt.tz(tzInfo).format(),
            tzInfo: tzInfo,
            utc: dt,
            unix: isUnix ? rawData : Date.parse(rawData)
          }
    } catch(e) {
        throw new Error('Invalid date time value');
    }
}


e.simulate = simulate;
e.getDocumentIds = getDocumentIds;
e.getServiceDoc = getServiceDoc;
e.encryptText = encryptText;
e.decryptText = decryptText;
e.getGeoDetails = getGeoDetails;
e.informThroughSocket = informThroughSocket;
e.isExpandAllowed = isExpandAllowed;
e.getFormattedDate = getFormattedDate;

module.exports = e;