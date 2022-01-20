"use strict";

const mongoose = require("mongoose");
const log4js = require('log4js');
const definition = require("../helpers/srvc2006.definition.js").definition;
const exportDefinition = require('../helpers/bulkAction.definition').definition;
const SMCrud = require("@appveen/swagger-mongoose-crud");
const swaggerParser = require('swagger-parser');
const cuti = require("@appveen/utils");
const fs = require("fs");
const helperUtil = require("../helpers/util.js");
const schema = new mongoose.Schema(definition);
const exportSchema = new mongoose.Schema(exportDefinition);
const crypto = require('crypto');
// const streamifier = require('streamifier');
const uuid = require("uuid/v1");
const BATCH = 500;
const logger = log4js.getLogger(global.loggerName);
const _ = require('lodash');
const init = require("../../init");
const dataStackNS = process.env.DATA_STACK_NAMESPACE
let XLSX = require('xlsx');
let queueMgmt = require('../../queueManagement.js');
var client = queueMgmt.client;
var zip = new require('node-zip')();
let async = require('async');
let mathQueue = async.priorityQueue(processMathRequest);
let runInit = true;
var options = {
    logger:logger,
    collectionName:"complex"
};

var exportOptions = {
    logger:logger,
    collectionName:"complex.fileTransfers"
};

let requiredRelation = []; ;




schema.index({ "_expireAt": 1 }, { expireAfterSeconds: 0 });
exportSchema.index({ "_metadata.createdAt": 1 }, { expireAfterSeconds: 24*3600 });


schema.index({"location.geometry" : "2dsphere"} , {"name": "location_geoJson"});



schema.index({"email" : 1} , {unique: "email field should be unique", sparse: true, collation: { locale: "en", strength: 2 } });
schema.index({"userId" : 1} , {unique: "userId field should be unique", sparse: true, collation: { locale: "en", strength: 2 } });

    let serviceId = process.env.SERVICE_ID || 'SRVC2006';
    const request = require('request');
    
    function getRelationCheckObj(obj, req){
        return helperUtil.crudDocuments(obj, "GET", null, null, req)
                .then(docs=>{
                    let retObj = JSON.parse(JSON.stringify(obj));
                    retObj.documents = docs;
                    return retObj;
                })
    }


    schema.pre("remove", function (next, req) {
            this._req = req;
            
        let promiseArr = [];
        let self = this;
        let inService = [];
        helperUtil.getServiceDetail(serviceId, req)
            .then((serviceDetail) => {
                let incoming = serviceDetail.relatedSchemas.incoming;
                if (incoming && incoming.length !== 0) {
                    inService = incoming.map(obj => {
                        obj.uri = obj.uri.replace('{{id}}', self._id);
                        return obj;
                    });
                }
            })
            .then(() => {
                inService.forEach(obj => {
                    if(process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT){
                        let split = obj.uri.split('/');
                        obj.host=split[2].split("?")[0].toLowerCase() + "." + dataStackNS + "-"+split[1].toLowerCase().replace(/ /g, "");
                        obj.port = 80;
                    }else{
                        obj.host = "localhost"
                    }
                    promiseArr.push(getRelationCheckObj(obj, req));
                });
                return Promise.all(promiseArr);
            })
            .then((_relObj)=>{
                if(_relObj && _relObj.length === inService.length){
                    _relObj.forEach(_o => {
                        if(_o.documents.length !== 0 && _o.isRequired){
                            next(new Error("Document still in use. Cannot Delete"));
                        }
                    });
                } else{
                    next(new Error("Cannot complete request"));
                }
                self._relObj = _relObj;
                next();
            })
            .catch((err)=>{
                next(err);
            });
    });        
    


    

    schema.post("remove", function (doc) {
            
        let updateList = [];
        doc._relObj.forEach(_o => {
            _o.documents.forEach(_oDoc => {
                let filter = _o.uri.split("?")[1].split("filter=")[1].split('&')[0];
                filter = JSON.parse(filter);
                let uriSplit = _o.uri.split("/");
                let _service = { port: _o.port, uri: _o.uri.split("?")[0] + "/" + _oDoc._id }
                if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
                    _service.port = 80;
                    _service.host = uriSplit[2].split("?")[0].toLowerCase() + "." + dataStackNS + "-" + uriSplit[1].toLowerCase().replace(/ /g, "");
                } else {
                    _service.host = "localhost";
                }
                let ulObj = updateList.find(_ul => _ul.serviceId === _o.service && _ul.doc._id === _oDoc._id);
                if (ulObj) {
                    ulObj.doc = helperUtil.generateDocumentObj(filter, ulObj.doc, doc._id);
                } else {
                    updateList.push({ serviceId: _o.service, doc: helperUtil.generateDocumentObj(filter, _oDoc, doc._id), _service: _service });
                }
            })
        })
        logger.debug(JSON.stringify({updateList}));
        updateList.forEach(ulObj => {
            helperUtil.crudDocuments(ulObj._service, "PUT", ulObj.doc, null, doc._req)
        })
    })
    

schema.pre('save', function(next){
	let self = this;
	if(self._metadata.version){
		self._metadata.version.release = process.env.RELEASE;
	}
	next();
});

schema.pre('save', function (next, req) {
    let self = this;
    try {
        return helperUtil.validateReferenceIds(self, {}, {}, req)
            .then(() => {
                next();
            })
            .catch(err => {
                logger.error(err);
                next(err);
            });
    } catch (err) {
        logger.error(err);
        next(err);
    }
});

let secureFields = 'password'.split(',');

function encryptText(_d){
    var options = {
        url: 'http://localhost:10007/sec/enc/Adam/encrypt',
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: {data: _d},
        json: true
    };
    return new Promise((resolve, reject)=>{
        request.post(options, function (err, res, body) {
            if (err) {
                logger.error("Error requesting Security service");
                reject(err);
            } else if (!res) {
                logger.error("Security service down");
                reject(new Error('Security service down'));
            }
            else {
                if(res.statusCode === 200){
                    let encryptValue = body.data;
                    let obj = {
                        value : encryptValue,
                        checksum : crypto.createHash('md5').update(_d).digest("hex")
                    };
                    body.data = obj;
                    resolve(body.data);
                }else{
                    reject(new Error('Error encrypting text'))
                }
            }
        });
    }) 
}

function encryptData(data, nestedKey, isUpdate, oldData) {
    let keys = nestedKey.split('.');
    if (keys.length == 1) {
        if (data[keys[0]]) {
            if (Array.isArray(data[keys[0]])) {
                if(!isUpdate || !oldData || !oldData[keys[0]] || !Array.isArray(oldData[keys[0]])){
                    let promises = data[keys[0]].map(_d => encryptText(_d.value));
                    return Promise.all(promises)
                        .then(_d => {
                            data[keys[0]] = _d;
                            return data;
                        })
                }else{
                    let diff = _.difference(data[keys[0]], oldData[keys[0]], (a, b) => a.value == b.value);
                    let intersection = _.difference(data[keys[0]], diff, (a, b) => a.value == b.value);
                    let promises = diff.map(_d => encryptText(_d.value));
                    return Promise.all(promises)
                        .then(_d => {
                            data[keys[0]] = _d.concat(intersection);
                            return data;
                        })
                }  
            } else if (data[keys[0]].value) {
                if(!isUpdate || !oldData || !oldData[keys[0]] || (isUpdate && oldData[keys[0]] != data[keys[0]])){
                    return encryptText(data[keys[0]].value)
                    .then(_d => {
                        data[keys[0]] = _d;
                        return data;
                    })
                }
                else{
                    return Promise.resolve(data);
                }
            }
        } else {
            return Promise.resolve(data);
        }
    } else {
        if (data[keys[0]]) {
            let ele = keys.shift();
            let newNestedKey = keys.join('.');
            if (Array.isArray(data[ele])) {
                if(!isUpdate || !oldData || !oldData[ele] || !Array.isArray(oldData[ele])){
                    let promises = data[ele].map(_d => encryptData(_d, newNestedKey, isUpdate, null));
                    return Promise.all(promises)
                        .then(_d => {
                            data[ele] = _d;
                            return data;
                        })
                }
                else{
                    let promises = data[ele].map(_d => {
                        let oData = oldData[ele].find(_od=>{
                            if(typeof _d === 'object' && typeof _od == 'object') return _.isEqual(JSON.parse(JSON.stringify(_d)), JSON.parse(JSON.stringify(_od)));
                            else if(typeof _d === typeof _od) return _.isEqual(_d, _od);
                            else return false;
                        });
                        return encryptData(_d, newNestedKey, isUpdate, oData);
                    });
                    return Promise.all(promises)
                        .then(_d => {
                            data[ele] = _d;
                            return data;
                        })
                }
            }
            let oData = oldData ? oldData[ele]: null;
            return encryptData(data[ele], newNestedKey, isUpdate, oData).then(() => data);
        } else {
            return Promise.resolve(data);
        }
    }
}


function getDiff(a, b, oldData, newData) {
    if (a === null || b === null) {
        Object.assign(oldData, a);
        Object.assign(newData, b);
    }
    else if (typeof a == "object" && typeof b == "object") {
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

function isValue(a) {
    return a == null || !(typeof a == 'object');
}

function isArray(a) {
    return Array.isArray(a);
}

function isEqual(a, b) {
    return (_.isEqual(a, b));
}

schema.post('save', function (error, doc, next) {
    if (!error) return next();
    if ((error.code == 11000 && error && error.errors) || (error && error.errors && error.errors._id)) {
        next(new Error('Cannot save: duplicate identifier'));
    }
    else if (error.code == 11000) {
        next(new Error('Unique check failed'));
    }
    else {
        next();
    }
});

schema.pre("save", cuti.counter.getIdGenerator("COM","complex",null,null,1001));
schema.pre("validate", function(next){
    var letter_number = /^[^?/\%$]+$/;
    let self = this;
    if(self._id){
        if(self._id.match(letter_number)){
            next();
        }else{
            next(new Error("Invalid id: id cannot contain ? / \ % $"));
        }
    }
    self._metadata.version.service = 2;
    next();
});

function getFieldValue(obj, key) {
    let keyArr = key.split('.');
    return keyArr.reduce((acc, curr, i) => {
        if (!acc) return null;
        return acc[curr];
    }, obj);
}

/*
schema.pre("save", function (next) {
    let self = this;
    let filter = {}, valMapping = {}, orFilter = [];
    uniqueFields.forEach(_k => {
        let val = getFieldValue(self, _k);
        if (typeof val == 'string') {
            valMapping[_k] = val;
            orFilter.push({ [_k]: val });
        }
    });
    if (Object.keys(valMapping).length == 0) return next();
    if (!self.isNew) {
        filter = { $and: [{ _id: { $ne: self._id } }, { $or: orFilter }] };
    } else {
        filter = { $or: orFilter };
        if (self._id) {
            filter['$or'].push({ _id: self._id })
        }
    }
    return crudder.model.findOne(filter).collation({ locale: "en", strength: 2 }).lean(true)
        .then(_d => {
            if (_d) {
                let errorFields = [];
                uniqueFields.forEach(_k => {
                    let val = getFieldValue(_d, _k);
                    if (typeof val == 'string' && valMapping[_k].toLowerCase() == val.toLowerCase()) {
                        errorFields.push(_k);
                    }
                });
                if (errorFields.length > 0) return next(new Error('Validation Failed:: ' + errorFields + ' unique check failed'));
            }
            next();
        })
        .catch(err => {
            logger.error(err);
            next(err);
        })
})

function idUniqueCheck(_id) {
    let idRegex = new RegExp('^' + _id + '$', 'i');
    return crudder.model.findOne({
        '_id': idRegex
    }).lean(true)
        .then(_d => {
            if (_d) {
                return Promise.reject(new Error('Id already exist'));
            } else {
                return Promise.resolve();
            }
        });
}

schema.pre('save', function (next) {
    let self = this;
    if (self.isNew) {
        return idUniqueCheck(self._id)
            .then(() => {
                next();
            })
            .catch(err => {
                logger.error(err);
                next(err);
            });
    } else {
        next();
    }
});
*/
/*
schema.pre("save", function(next, req){
    let self = this;
    if(!self._id){
        return next();
    }
    helperUtil.isWorkflowPresent(self._id, serviceId,req)
    .then(isWF => {
        if(isWF){
            next(new Error("Workflow is present for current document. Cannot update"));
        }else{
            next();
        }
    })
})

schema.pre("remove", function(next, req){
    let self = this;
    helperUtil.isWorkflowPresent(self._id, serviceId, req)
    .then(isWF => {
        if(isWF){
            next(new Error("Workflow is present for current document. Cannot update"));
        }else{
            next();
        }
    })
})
*/


let precisionFields = [{"field":"contactNo","precision":0},{"field":"alternateNos","precision":0},{"field":"tempAddress.pincode","precision":0},{"field":"prevAddress.pincode","precision":0}];

function doPrecision(data, nestedKey, val){
    let keys = nestedKey.split('.');
    let oldVal = keys.reduce((acc, curr, i) => {
        if(acc){
            if(i === keys.length -1 && acc[curr]){
                let no = Math.pow(10, parseInt(val));
                if(Array.isArray(acc[curr])){
                    acc[curr].forEach((_c, i1)=>{
                        acc[curr][i1] = Math.round(parseFloat(_c) * no)/no;    
                    })
                }else{
                    acc[curr] = Math.round(parseFloat(acc[curr]) * no)/no;
                }             
            }
            if(acc && acc[curr]){
                return acc[curr];
            }else{
                return null;
            }
        }
    }, data);
    return data;
}

schema.pre('validate', function (next) {
    let obj = this;
    let data = null;
    requiredRelation.forEach(key => {
        let keys = key.split('.');
        let val = keys.reduce((acc, curr, i) => acc ? acc[curr] : undefined, obj);
        if (!val  || !val._id) {
            next(new Error("Required relation can not be empty"));
        }
    })
    next();
});

schema.pre("save", function(next, req){
    let self = this;
    precisionFields.forEach(_p=>{
        doPrecision(self, _p.field, _p.precision);
    })
    next();
});

/*schema.pre("save", function (next, req) {
    let self = this;
    let selfCopy = JSON.parse(JSON.stringify(self));
    selfCopy._metadata.createdAt = self._metadata.createdAt;
    return helperUtil.getPreHooks().reduce(function(acc, curr){
        let oldData = null;
        let preHookLog = null;
        let newData = null;
        return acc
            .then(data => {
                oldData = data;
                return mongoose.model("preHooks").create({
                    "docId": data._id,
                    "service": process.env.SERVICE_ID || 'SRVC2006',
                    "timestamp": new Date(),
                    "url": curr.url,
                    "operation": req.method,
                    "txnId": req.headers[global.txnIdHeader],
                    "name": curr.name,
                    "data": {
                        "old": oldData
                    },
                    "status": "Pending",
                    
                })
            })
            .then(_preHookLog => {
                preHookLog = _preHookLog;
                let options = {
                    operation: req.method,
                    data: oldData
                } 
                return helperUtil.invokeHook(curr.url, options, curr.failMessage)
            })
            .then(data => {
                newData = Object.assign({}, oldData, data.data);//Object.assign(target, ...sources)
                newData._metadata = oldData._metadata;
                return mongoose.model("preHooks").updateOne({ _id: preHookLog._id }, {"status": "Completed", "data.new": newData, "_metadata.lastUpdated": new Date()})
            })
            .then(() => {
                return newData;
            })
            .catch(err=>{
                next(err);
                if(preHookLog && preHookLog._id){
                    mongoose.model("preHooks").updateOne({ _id: preHookLog._id }, {"status": "Error","comment": err.message, "data.new": newData, "_metadata.lastUpdated": new Date()}).then();
                }
            })           
    }, Promise.resolve(selfCopy))
        .then(data=>{
            Object.assign(self, data);
            return self.validate();
        })
        .then(() => next())
        .catch(err=>{
            next(err);
        })
});*/

schema.pre("save", function (next, req) {
    let self = this;
    var obje = {};
    let selfCopy = JSON.parse(JSON.stringify(self));
    selfCopy._metadata.createdAt = self._metadata.createdAt;
    return helperUtil.getPreHooks().reduce(function(acc, curr){
        let oldData = null;
        let preHookLog = null;
        let newData = null;
        return acc
            .then(data => {
                oldData = data;
                 obje = {
                    "docId": data._id,
                    "service": process.env.SERVICE_ID || 'SRVC2006',
                    "colName": 'Adam.complex.preHook',
                    "timestamp": new Date(),
                    "url": curr.url,
                    "operation": self.isNew ? 'POST' : 'PUT', // Changed from req.method
                    "txnId": req.headers[global.txnIdHeader],
                    "name": curr.name,
                    "data": {
                        "old": oldData
                    },
                    "status": "Pending",
                    "_metadata":{                      
                    }
                }

                let options = {
                    operation: self.isNew ? 'POST' : 'PUT', // Changed from req.method
                    data: oldData,
                    trigger:{
                        source: 'presave',
                        simulate: false
                    },
                    txnId: req.headers[global.txnIdHeader],
                    user: req.headers[global.userHeader],
                    dataService: process.env.SERVICE_ID || 'SRVC2006'
                } 
                return helperUtil.invokeHook(curr.url, options, curr.failMessage)
            })
            .then(data => {
                newData = Object.assign({}, oldData, data.data);
                newData._metadata = oldData._metadata;
                obje["status"] = "Completed";
                obje._metadata.createdAt= new Date();
                obje._metadata.lastUpdated = new Date();
                obje.data.new = newData;
               // {"status": "Completed", "data.new": newData, "_metadata.lastUpdated": new Date()}
                client.publish("prehookCreate", JSON.stringify(obje));
            })
            .then(() => {
                return newData;
            })
            .catch(err=>{
                next(err);
                      obje["status"] = "Error";
                      obje.data.new = newData;
                      obje["comment"] = err.message;
                      obje._metadata.lastUpdated= new Date();
                    client.publish("prehookCreate", JSON.stringify(obje));
                    //mongoose.model("preHooks").updateOne({ _id: preHookLog._id }, {"status": "Error","comment": err.message, "data.new": newData, "_metadata.lastUpdated": new Date()}).then();
                
            })           
    }, Promise.resolve(selfCopy))
        .then(data=>{
            Object.assign(self, data);
            return self.validate();
        })
        .then(() => next())
        .catch(err=>{
            next(err);
        })
});

function getWebHookAndAuditData(req, id, isNew) {
    let data = {};
    data.serviceId = serviceId;
    data.operation = req.method;
    data.user = req.headers[global.userHeader];
    data.txnId = req.headers[global.txnIdHeader];
    data.timeStamp = new Date();
    data.data = {};
    if (id) {
        let promise = isNew ? Promise.resolve(null) : crudder.model.findOne({ _id: id });
        return promise
            .then(doc => {
                if (doc) {
                    data.operation = data.operation == "DELETE" ? data.operation : "PUT"
                    data.data.old = JSON.stringify(doc.toJSON());
                }
                else {
                    data.data.old = null;
                }
                return data;
            });
    }
    return Promise.resolve(data);
}

/*function pushWebHookAndAuditData(webHookData, newData) {
    webHookData._id = newData._id;
    webHookData.data.new = JSON.stringify(newData);
    queueMgmt.sendToQueue(webHookData);
    let auditData = {};
    auditData.user = webHookData.user;
    auditData.txnId = webHookData.txnId;
    auditData.timeStamp = webHookData.timeStamp;
    auditData.data = {};
    auditData.data.old = {};
    auditData.data.new = {};
    auditData._metadata = {};
    auditData._metadata.lastUpdated = new Date();
    auditData._metadata.createdAt = new Date();
    auditData._metadata.deleted = false;
    auditData.data._id = JSON.parse(webHookData.data.new)._id;
    auditData.data._version = JSON.parse(webHookData.data.new)._metadata.version.document;
    getDiff(JSON.parse(webHookData.data.old), JSON.parse(webHookData.data.new), auditData.data.old, auditData.data.new);
    let oldLastUpdated = auditData.data.old && auditData.data.old._metadata ? auditData.data.old._metadata.lastUpdated : null;
    let newLastUpdated = auditData.data.new && auditData.data.new._metadata ? auditData.data.new._metadata.lastUpdated : null;
    if(oldLastUpdated) delete auditData.data.old._metadata.lastUpdated;
    if(newLastUpdated) delete auditData.data.new._metadata.lastUpdated;
    
    if (!_.isEqual(auditData.data.old, auditData.data.new)) {
        if(oldLastUpdated) auditData.data.old._metadata.lastUpdated = oldLastUpdated;
        if(newLastUpdated) auditData.data.new._metadata.lastUpdated = newLastUpdated;
        mongoose.connection.db.collection('Adam.complex.audit').insert(auditData);
        
    }
}*/

function pushWebHookAndAuditData(webHookData, newData) {
    webHookData._id = newData._id;
    webHookData.data.new = JSON.stringify(newData);
    queueMgmt.sendToQueue(webHookData);
    let auditData = {};
    auditData.versionValue = '-1'
    auditData.user = webHookData.user;
    auditData.txnId = webHookData.txnId;
    auditData.timeStamp = webHookData.timeStamp;
    auditData.data = {};
    auditData.data.old = {};
    auditData.data.new = {};
    auditData._metadata = {};
    auditData.colName = 'Adam.complex.audit'
    auditData._metadata.lastUpdated = new Date();
    auditData._metadata.createdAt = new Date();
    auditData._metadata.deleted = false;
    auditData.data._id = JSON.parse(webHookData.data.new)._id;
    auditData.data._version = JSON.parse(webHookData.data.new)._metadata.version.document;
    getDiff(JSON.parse(webHookData.data.old), JSON.parse(webHookData.data.new), auditData.data.old, auditData.data.new);
    let oldLastUpdated = auditData.data.old && auditData.data.old._metadata ? auditData.data.old._metadata.lastUpdated : null;
    let newLastUpdated = auditData.data.new && auditData.data.new._metadata ? auditData.data.new._metadata.lastUpdated : null;
    if(oldLastUpdated) delete auditData.data.old._metadata.lastUpdated;
    if(newLastUpdated) delete auditData.data.new._metadata.lastUpdated;
    
    if (!_.isEqual(auditData.data.old, auditData.data.new)) {
        if(oldLastUpdated) auditData.data.old._metadata.lastUpdated = oldLastUpdated;
        if(newLastUpdated) auditData.data.new._metadata.lastUpdated = newLastUpdated;
       // mongoose.connection.db.collection('Adam.ptest.audit').insert(auditData);
       //console.log('client is',client);
       if(auditData.versionValue != 0){
       client.publish("auditQueue", JSON.stringify(auditData))
       }
         
    }
}

schema.pre("save", function (next, req) {
    let self = this;
    getWebHookAndAuditData(req, self._id, self.isNew)
        .then(data => {
            this._webHookData = data;
            next();
        });
});

let createOnlyFields = 'userId'.split(',');

function checkEqualCreateOnly(a, b){
    if((a != null && typeof a == 'object') || ( b != null && typeof b == 'object')){
        if((a && a._id && a._href) || (b && b._id && b._href)){
            return a && b && a._id === b._id;
        }else{
            return _.isEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
        }    
    }else{
        return a == b;
    }
    
}

function checkCreateOnlyField(oldData, newData, nestedKey){
    let keys = nestedKey.split('.');
    let oldVal = keys.reduce((acc, curr, i) => acc ? acc[curr] : null, oldData);
    let newVal = keys.reduce((acc, curr, i) => acc ? acc[curr] : null, newData);
    return checkEqualCreateOnly(oldVal, newVal);
    // if(newVal != oldVal){
    //     return false;
    // }else{
    //     return true;
    // }
}

schema.pre("save", function(next, req){
    let self = this;
    if(!self.isNew){
        let oldData = self._webHookData && self._webHookData.data && self._webHookData.data.old ? JSON.parse(self._webHookData.data.old) : null;
        let newData = JSON.parse(JSON.stringify(self));
        let flag = createOnlyFields.reduce((acc, curr)=> acc && checkCreateOnlyField(oldData, newData, curr), true);
        if(flag) next();
        else{
            next(new Error('Cannot edit non editable fields'));
        }
    }else{
        next();
    }
});

schema.pre("save", function(next, req){
    let self = this;
    let dup = enrichWithHref(self, req);
    next();
});

let uniqueFields = 'email,userId'.split(',');

function removeNull(obj, plainObj) {
    if (typeof plainObj === 'object' && plainObj != null) {
        Object.keys(plainObj).forEach(key => {
            if (typeof plainObj[key] === 'object') {
                removeNull(obj[key], plainObj[key]);
            }
            if (plainObj[key] === null) {
                obj[key] = undefined;
            }
            if (plainObj[key] != null && typeof plainObj[key] === 'object' && !(plainObj[key] instanceof Date) && Object.keys(plainObj[key]).length === 0) {
                obj[key] = undefined;
            }
        })
    }
}

function removeNullForUnique(obj, key) {
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

schema.pre("validate", function (next, req) {
    let self = this;
    uniqueFields.forEach(_k=>{
        removeNullForUnique(self, _k)
    });
    next();
});

schema.pre("save", function (next, req) {
    let self = this;
    uniqueFields.forEach(_k=>{
        removeNullForUnique(self, _k)
    });
    next();
});

schema.post("save", function (doc) {
    pushWebHookAndAuditData(doc._webHookData, doc.toJSON())
});

schema.pre("remove", function(next, req){
    let self = this;
    let data = {};
    data.serviceId = serviceId;
    data.operation = req.method;
    data.user = req.headers[global.userHeader];
    data.txnId = req.headers[global.txnIdHeader];
    data.timeStamp = new Date();
    data._id = self._id;
    data.data = {};
    data.data.new = null;
    data.data.old = JSON.stringify(self.toJSON());
    self._webHookData = data;
    next();
});

function deleteFile(filename) {
    global.gfsBucket.find({
        filename: filename
    }).toArray(function (err, result) {
        if (err) {
            logger.error(err);
        } else {
            if(result[0]){
                global.gfsBucket.delete(result[0]._id, function(err){
                    if(err){
                        logger.error(err);
                    }else{
                        logger.info("Removed related file");
                    }
                })
            }else{
                logger.error('File not found ' + filename);
            }
        }
    });
}

let fileFields = "resume".split(',');

schema.post("remove", function (doc) {
            fileFields.forEach(_f => {
                let ob = _f.split(".").reduce((prev, curr) => {
                    return prev ? prev[curr] : null;
                }, doc)
                if (ob) {
                    if (Array.isArray(ob)) {
                        ob.forEach(obj => {
                            if (obj.filename)
                                deleteFile(obj.filename)
                        })
                    } else {
                        if (ob.filename) {
                            deleteFile(ob.filename)
                        }
                    }
                }
            })
        })
/*
schema.post("remove", function(doc){
    let webHookData = doc._webHookData;
    queueMgmt.sendToQueue(doc._webHookData);
    let auditData = {};
    auditData.user = webHookData.user;
    auditData.txnId = webHookData.txnId;
    auditData.timeStamp = webHookData.timeStamp;
    auditData.data = {};
    auditData.data.old = {};
    auditData.data.new = {};
    auditData._metadata.lastUpdated = new Date();
    auditData._metadata.createdAt = new Date();
    auditData._metadata.deleted = false;
    auditData.data._id = JSON.parse(webHookData.data.old)._id;
    auditData.data._version = JSON.parse(webHookData.data.old)._metadata.version.document;
    getDiff(JSON.parse(webHookData.data.old), JSON.parse(webHookData.data.new), auditData.data.old, auditData.data.new);
    let oldLastUpdated = auditData.data.old && auditData.data.old._metadata ? auditData.data.old._metadata.lastUpdated : null;
    let newLastUpdated = auditData.data.new && auditData.data.new._metadata ? auditData.data.new._metadata.lastUpdated : null;
    if(oldLastUpdated) delete auditData.data.old._metadata.lastUpdated;
    if(newLastUpdated) delete auditData.data.new._metadata.lastUpdated;
    
    if(!_.isEqual(auditData.data.old, auditData.data.new)){
        if(oldLastUpdated) auditData.data.old._metadata.lastUpdated = oldLastUpdated;
        if(newLastUpdated) auditData.data.new._metadata.lastUpdated = newLastUpdated;
        mongoose.connection.db.collection('Adam.complex.audit').insert(auditData);
        
    }
});
*/

schema.post("remove", function(doc){
    let webHookData = doc._webHookData;
    queueMgmt.sendToQueue(doc._webHookData);
    let auditData = {};
    auditData.id = doc._id;
    auditData.colName = 'Adam.complex.audit';
    client.publish('auditQueueRemove',JSON.stringify(auditData))
});

function addAuthHeader(paths, jwt){
    Object.keys(paths).forEach(path=>{
        Object.keys(paths[path]).forEach(method=>{
            if(typeof paths[path][method] == "object" && paths[path][method]["parameters"]){
                let authObj = paths[path][method]["parameters"].find(obj => obj.name == "authorization");
                if(authObj) authObj.default = jwt;
            }
        })
    })
}

schema.pre("save", function(next, req){
    if(secureFields.length == 0) return next();
    let self = this;
    if(self.isNew){
        let promise = secureFields.reduce((acc, curr)=>{
            return acc.then(_d=>encryptData(_d, curr));
        }, Promise.resolve(self));
        promise.then(()=>{
            next();
        })
    }else{
        return crudder.model.findOne({ _id: self._id }).lean(true).then(oldData=>{
            if(oldData){
                let promise = secureFields.reduce((acc, curr)=>{
                    return acc.then(_d => encryptData(_d, curr, true, oldData));
                }, Promise.resolve(self));
                return promise.then(()=>{
                    next();
                })
                .catch(err=>{
                    logger.error(err.message);
                    next(err);
                })
            }else{
                next();
            }
        })
        .catch(err=>{
            logger.error(err.message);
            next(err);
        })
    }
});

var crudder = new SMCrud(schema,"complex", options);

var exportCrudder = new SMCrud(exportSchema,"complex.fileTransfers", exportOptions);

var e = {};
e.doc = (_req, _res)=>{
    swaggerParser.parse("./api/swagger/swagger.yaml")
        .then((obj)=>{
            obj.host = _req.query.host;
            obj.basePath = _req.query.basePath ? _req.query.basePath : obj.basePath;
            addAuthHeader(obj.paths, _req.query.token);
            _res.status(200).json(obj);
        })
}

// e.fileUpload = (_req, _res) => {
//     let sampleFile = _req.files.file;
//     let fileName = sampleFile.name;
//     streamifier.createReadStream(sampleFile.data).
//         pipe(global.gfsBucket.openUploadStream(crypto.createHash('md5').update(uuid() + global.serverStartTime).digest("hex"), {
//             contentType: sampleFile.mimetype,
//             metadata: {
//                 filename: fileName
//             }
//         })).
//         on('error', function (error) {
//             logger.error(error);
//         }).
//         on('finish', function (file) {
//             logger.debug('File uploaded to gridFS');
//             _res.json(file);
//         });
// }

e.fileView = (_req, _res) => {
    var id = _req.swagger.params.id.value;
    global.gfsBucket.find({
        filename : id
      }).toArray(function (err, file) {
        if (err) return _res.status(500).json({message: err.message});
        if(file[0]){
            let readstream = global.gfsBucket.openDownloadStream(file[0]._id);
            readstream.on("error", function(err) { 
                logger.error(err);
                return _res.end();
            });
            readstream.pipe(_res); 
        } else{
            _res.status(400).json({message: "File not found"});
        }
      });
}

e.fileDownload = (_req, _res) => {
    var id = _req.swagger.params.id.value;
    global.gfsBucket.find({ filename: id },{limit: 1}).toArray(function (err, file) {
        if (err) {
            return _res.status(400).send(err.message);
        }
        else if (!file[0]) {
            return _res.status(400).send('File not found');
        }
        file = file[0];
        _res.set('Content-Type', file.contentType);
        _res.set('Content-Disposition', 'attachment; filename="' + file.metadata.filename + '"');
    
        var readstream = global.gfsBucket.openDownloadStream(file._id);
    
        readstream.on("error", function(err) { 
            logger.error(err);
            _res.end();
        });
        readstream.pipe(_res);
      });
}

e.exportedFileDownload = (_req, _res) => {
    var id = _req.swagger.params.id.value;
    global.gfsBucketExport.find({ "metadata.uuid": id }, { limit: 1 }).toArray(function (err, file) {
        if (err) {
            return _res.status(400).send(err.message);
        }
        else if (!file[0]) {
            return _res.status(400).send('File not found');
        }
        file = file[0];
        _res.set('Content-Type', file.contentType);
        var fileName = _req.swagger.params.filename.value? _req.swagger.params.filename.value+'.zip':file.metadata.filename
        
        _res.set('Content-Disposition', 'attachment; filename="' + fileName + '"');

        var readstream = global.gfsBucketExport.openDownloadStream(file._id);

        readstream.on("error", function (err) {
            logger.error(err);
            _res.end();
        });
        readstream.pipe(_res);
    });
}

function customizer(objValue, srcValue) {
    if (_.isArray(srcValue) || _.isArray(objValue)) {
        return srcValue;
    }
}

function computeData(latestDoc, auditArr) {
    return auditArr.reduce((_p, _c) => _.mergeWith(_p, _c, customizer), latestDoc);
}

function customShow(_req, _res) {
    let contentType = _req.headers["Content-Type"];
    let version = contentType ? contentType.split(";")[1] : null;
    version = version ? version.split("=")[1] : null;
    version = version ? parseInt(version) : null;
    if (!version && version !== 0) {
        return crudder.show(_req, _res);
    }
    let id = _req.swagger.params.id.value;
    let latestDoc = null;
    crudder.model.findOne({ _id: id })
        .then(_d => {
            if (_d) {
                latestDoc = _d.toObject();
                return mongoose.model('complex.audit').find({ "data._version": { "$gte": version }, "data._id": id }, "data -_id", { sort: { "data._version": -1 } })
            }
            _res.status(404).json({ message: "document not found" });
            return;
        })
        .then(docs => {
            if (docs) {
                docs = docs.map(obj => obj.toObject());
                let allVersions = docs.map(obj => obj.data._metadata.version.document);
                if (allVersions.indexOf(version) == -1) {
                    return _res.status(404).json({ message: "Document version " + version + " not found" });
                }
                docs = docs.filter(obj => {
                    return obj.data._metadata.version.document > version
                });
                docs = docs.map(obj => obj.data.old);
                let result = computeData(latestDoc, docs);
                _res.send(result)
            }

        })
        .catch(err => {
            logger.error(err);
            _res.status(500).send(err.message);
        })
}



function fetchExtData(id, serviceId, select, documentCache, serviceDetailCache, req) {

    if (documentCache[`${serviceId}##${id}##${select}`]) {
        return documentCache[`${serviceId}##${id}##${select}`];
    }
    documentCache[`${serviceId}##${id}##${select}`] = helperUtil.getStoredServiceDetail(serviceId, serviceDetailCache, req)
        .then(_sd => {
            let _service = { port: _sd.port, uri: "/" + _sd.app + _sd.api };
            if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
                _service.port = 80;
                _service.host = _sd.api.substr(1).toLowerCase() + "." + dataStackNS + "-" + _sd.app.toLowerCase().replace(/ /g, "");
            } else {
                _service.host = "localhost";
            }
            let qs = {
                "filter": JSON.stringify({ _id: id }),
                "select": select,
                "count": 1
            }
            return helperUtil.crudDocuments(_service, "get", null, qs, req)
                .then(_d => {
                    return _d[0];
                })
        });
    return documentCache[`${serviceId}##${id}##${select}`];

}

function enrichForARelationCache(srvcId, path, document, select, documentCache, serviceDetailCache, visitedDocs, req) {
    if(!document) return Promise.resolve(document);
    if (typeof path == 'string') {
        let id = document._id;
        if(!id) return Promise.resolve(id);
        if (visitedDocs[srvcId] && visitedDocs[srvcId].indexOf(id) > -1) return Promise.resolve(document);
        // if select has only _href or _id no need to expand;
        let selectSplit = select.split(',');
        if (selectSplit.length > 0 && !selectSplit.some(_s => ['_id', '_href'].indexOf(_s) == -1)) {
            return Promise.resolve(document);
        }
        let newSelectionObject;
        return helperUtil.getStoredServiceDetail(srvcId, serviceDetailCache, req)
            .then(_sd => {
                newSelectionObject = getSelectionObject(_sd, select.split(','));
                return fetchExtData(id, srvcId, newSelectionObject.querySelect.join(','), documentCache, serviceDetailCache, req)
            })
            .then(_d => {
                return expandStoredRelation(srvcId, _d, visitedDocs, newSelectionObject, req, true, serviceDetailCache, documentCache);
            })
    } else if (path && {}.constructor == path.constructor) {
        let key = Object.keys(path)[0];
        if (key == '_self' && Array.isArray(document)) {
            let val = path[key];
            let promises =  document.map(_d => {
                return enrichForARelationCache(srvcId, val, _d, select, documentCache, serviceDetailCache, visitedDocs, req);
            })
            return Promise.all(promises);
        }
        else {
            let val = path[key];
            return enrichForARelationCache(srvcId, val, document[key], select, documentCache, serviceDetailCache, visitedDocs, req)
                .then(_d => {
                    document[key] = _d;
                    return document;
                })
        }
    }
    return document;
}

function expandStoredRelation(serviceId, document, visitedDocs, selectionObject, req, expand, serviceDetailsObj, documentCache) {
    let srvcObj = {};
    return helperUtil.getStoredServiceDetail(serviceId, serviceDetailsObj, req)
        .then(_s => {
            srvcObj = _s;
            let promises = [];
            if (_s.relatedSchemas && _s.relatedSchemas.outgoing && _s.relatedSchemas.outgoing.length > 0) {
                promises = _s.relatedSchemas.outgoing.map(_rs => {
                    let selObj = selectionObject.extSelect.find(_es => _es.service == _rs.service && _es.path == _rs.path);
                    if (selObj) {
                        let newSelectionObject = getSelectionObject(_rs, selObj.field);
                        if (newSelectionObject.querySelect.length > 0 && !newSelectionObject.querySelect.some(_s => ['_id', '_href'].indexOf(_s) == -1)) {
                            return Promise.resolve(document);
                        }
                        return enrichForARelationCache(_rs.service, JSON.parse(_rs.path), document, newSelectionObject.querySelect.join(','), documentCache, serviceDetailsObj, visitedDocs, req);
                    }
                })
                return Promise.all(promises);
            } else {
                return Promise.resolve(document);
            }
        })
        .then(() => {
            let promises = [];
            if (srvcObj.relatedSchemas && srvcObj.relatedSchemas.internal && srvcObj.relatedSchemas.internal.users && srvcObj.relatedSchemas.internal.users.length > 0) {
                promises = srvcObj.relatedSchemas.internal.users.map(_rs => {
                    let path = JSON.parse(_rs.path);
                    return expandUserDoc(path, document, selectionObject);
                })
                return Promise.all(promises);
            }
            else {
                return Promise.resolve(document);
            }
        })
        .then(() => document);
}


function expandUserDoc(pathList, doc, selectionObject) {
    let sel = '';
    let temp = [];
    let usrIds = [];
    let promises = [];
    let usrDoc = [];
    let allData = false;
    let allDetails = 'basicDetails,username,description,attributes';
    let flatternPathList = getSelect(pathList, '');
    let idList  = [];
    temp.push(getUserIdList(pathList, doc,idList));
    temp.forEach(usrId => {
        usrId.forEach(doc => {
            usrIds.push(doc);
        })
    })

    selectionObject.userSel.map(select => {
        if (Object.keys(select)[0] == flatternPathList) {
            if (select[flatternPathList] == '') allData = true;
            sel += select[flatternPathList] + ",";
        }
    })
    if (sel == "" || sel == "," || allData) {
        sel = allDetails;
    }
    usrIds.map(usr => {
        promises.push(getUserDocuments(sel, { _id: usr }));
    })
    return Promise.all(promises)
        .then(usrDocs => {
            usrDocs.forEach(usr => {
                usr.forEach(doc => {
                    usrDoc.push(doc);
                })
            })
            substituteUserDoc(doc, Object.keys(flatten(pathList))[0], usrDoc, null);
            return doc;
        });
}

function getUserIdList(path, doc,idList) {
    if (!doc) return idList;
    if (typeof path === 'object' && Object.keys(path)[0] === '_self') {
        doc.forEach(obj => {
            if (typeof path['_self'] !== "object") {
                if (obj) {
                    idList.push(obj._id);
                }
            } else {
                return getUserIdList(path['_self'], obj,idList);
            }
        })
    } else if (typeof path === 'object') {
        return getUserIdList(path[Object.keys(path)[0]], doc[Object.keys(path)[0]],idList)
    } else {
        if (doc._id) {
            idList.push(doc._id);
        }
    }
    return idList;
}


function getUserDocuments(select, filter, req) {
    var options = {
        url: "http://localhost:10004/rbac/usr",
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        },
        qs: {
            filter: JSON.stringify(filter),
            select: select,
            count: -1
        },
        json: true
    };
    return new Promise((resolve, reject) => {
        request.get(options, function (err, res, body) {
            if (err) {
                logger.error("Error requesting user management")
                logger.error(err.message);
                reject(err);
            } else if (!res) {
                logger.error("user management down");
                reject(new Error("user management down"));
            } else {
                if (res.statusCode === 200) {
                    resolve(body);
                } else {
                    logger.debug(JSON.stringify(body))
                    reject(new Error("User API failed"));
                }
            }
        });
    });
}

function substituteUserDoc(doc, path, userDocs) {
    let pathSplit = path.split('.');
    let key = pathSplit.shift();
    if(key == "_self") key = pathSplit.shift();
    if (doc.constructor == {}.constructor && key && doc[key] && key != '_id') {
        if (Array.isArray(doc[key])) {
            let newKey = pathSplit.join('.');
            doc[key] = doc[key].map(_d => substituteUserDoc(_d, newKey, userDocs))
        } else {
            doc[key] = substituteUserDoc(doc[key], pathSplit.join('.'), userDocs);
            return doc;
        }
    } else if (pathSplit.length == 0 && doc) {
        let usr = userDocs.find(_u => _u._id == doc._id);
        if (!usr) return doc;
        return usr;
    }
    return {};
}

let crudderHelper = require("../helpers/crudder");
function getSelect(obj, key) {
    if (typeof obj == 'object') {
        let obKey = Object.keys(obj)[0];
        let newKey = key;
        if (obKey != "_self") newKey = key == '' ? obKey : key + '.' + obKey;
        return getSelect(obj[obKey], newKey);
    }
    else {
        return key;
    }
}

function getSelectionObject(_sd, select) {
    let querySelect = [];
    let extSelect = [];
    let userSel = [];
    if ((_sd.relatedSchemas && _sd.relatedSchemas.outgoing && _sd.relatedSchemas.outgoing.length > 0) || (_sd.relatedSchemas && _sd.relatedSchemas.internal && _sd.relatedSchemas.internal.users && _sd.relatedSchemas.internal.users.length > 0)) {
        if (_sd.relatedSchemas && _sd.relatedSchemas.outgoing && _sd.relatedSchemas.outgoing.length > 0) {
            _sd.relatedSchemas.outgoing.forEach(_rs => {
                // extSelect.push({ service: _rs.service, "field": [] });
                let pathSelect = getSelect(JSON.parse(_rs.path), '');
                if (select.length == 0) extSelect.push({ service: _rs.service, "field": [], path: _rs.path });
                select.forEach(_sel => {
                    if (_sel.startsWith("-")) {
                        if (_sel.startsWith("-" + pathSelect)) {
                            if (_sel == "-" + pathSelect) {
                                querySelect.push(_sel);
                            } else {
                                let field = _sel.replace(new RegExp(`^(-${pathSelect}.)`), "-");
                                let selObj = extSelect.find(_e => _e.service == _rs.service && _e.path == _rs.path);
                                if (selObj) selObj.field.push(field);
                                else extSelect.push({ service: _rs.service, "field": [field], path: _rs.path });
                            }
                        } else {
                            querySelect.push(_sel);
                        }
                    }
                    else if (_sel.startsWith(pathSelect + '.')) {
                        let isCoreKey = (_sel == pathSelect + '._id') || (_sel == pathSelect + '._href');
                        isCoreKey ? querySelect.push(_sel) : querySelect.push(pathSelect + '._id');
                        if (_sel === pathSelect) {
                            let selObj = extSelect.find(_e => _e.service == _rs.service && _e.path == _rs.path);
                            if (!selObj) extSelect.push({ service: _rs.service, "field": [], path: _rs.path });
                        }
                        else {
                            let selObj = extSelect.find(_e => _e.service == _rs.service && _e.path == _rs.path);
                            if (selObj) selObj.field.push(_sel.replace(new RegExp(`^(${pathSelect}.)`), ""));
                            else extSelect.push({ service: _rs.service, "field": [_sel.replace(new RegExp(`^(${pathSelect}.)`), "")], path: _rs.path });
                        }
                    } else {
                        querySelect.push(_sel);
                    }
                });
                if (querySelect.indexOf("-" + pathSelect) > -1) {
                    extSelect = extSelect.filter(_extS => _extS.path != _rs.path)
                }
            });
        }
        if (_sd.relatedSchemas && _sd.relatedSchemas.internal && _sd.relatedSchemas.internal.users && _sd.relatedSchemas.internal.users.length > 0) {
            _sd.relatedSchemas.internal.users.forEach(_rs => {
                select.forEach(_sel => {
                    let pathSelect = getSelect(JSON.parse(_rs.path), '');
                    if (_sel == pathSelect) {
                        querySelect.push(pathSelect);
                        let obj = {};
                        obj[pathSelect] = "";
                        userSel.push(obj);
                    }
                    else if (_sel.startsWith(pathSelect)) {
                        querySelect.push(pathSelect);
                        let obj = {};
                        obj[pathSelect] = _sel.replace(new RegExp(`^(${pathSelect}.)`), "");
                        userSel.push(obj);
                    }
                    else {
                        querySelect.push(_sel);
                    }

                })
            })
        }
    } else {
        querySelect = select;
    }
    querySelect = _.uniq(querySelect);
    return {
        querySelect,
        extSelect,
        userSel
    };
}

/*
function createExtFilter(filter, path, flag){
    if(Array.isArray(filter)){
        return filter.map(_f => createExtFilter(_f, path))
    }
    if(typeof filter === 'object'){
        let newFilter = {};
        Object.keys(filter).forEach(_k=>{
            if(_k.startsWith(path)){
                let newKey = _k.replace(new RegExp(`^(${path}.)`), "");
                newFilter[newKey] = createExtFilter(filter[_k], path);
                flag.flag = true;
            }else if(_k.startsWith('$')){
                newFilter[_k] = createExtFilter(filter[_k], path)
            }
        })
        return newFilter;
    }
    else{
        return filter;
    }
}
*/
function createFilterForARelation(filter, path, service, req) {
    if (Array.isArray(filter)) {
        let promises = filter.map(_f => createFilterForARelation(_f, path, service, req));
        return Promise.all(promises);
    }
    if (filter!=null && typeof filter === 'object') {
        let newFilter = {};
        let promises = Object.keys(filter).map(_k => {
            if (_k.startsWith(path)) {
                let newKey = _k.replace(new RegExp(`^(${path}.)`), "");
                return getExtIds({ [newKey]: filter[_k] }, service, req)
                    .then(_d => {
                        newFilter[path + '._id'] = { '$in': _d };
                    })
            } else {
                return createFilterForARelation(filter[_k], path, service, req)
                    .then(_f => {
                        newFilter[_k] = _f;
                        return _f;
                    })
            }
        })
        return Promise.all(promises).then(() => {
            return newFilter;
        })
    }
    else {
        return Promise.resolve(filter);
    }
}
/*
function createIntFilter(filter, path){
    if(Array.isArray(filter)){
        return filter.map(_f => createIntFilter(_f, path))
    }
    if(typeof filter === 'object'){
        let newFilter = {};
        Object.keys(filter).forEach(_k=>{
            if(!_k.startsWith(path)){
                newFilter[_k] = createIntFilter(filter[_k], path);
            }else if(_k.startsWith('$')){
                newFilter[_k] = createIntFilter(filter[_k], path)
            }
        })
        return newFilter;
    }
    else{
        return filter;
    }
}
*/
function createFilter(_sd, filter, req) {
    if (_sd.relatedSchemas && _sd.relatedSchemas.outgoing && _sd.relatedSchemas.outgoing.length > 0) {
        let promise = _sd.relatedSchemas.outgoing.reduce((acc, _rs) => {
            return acc.then(_filter=>{
                let path = getSelect(JSON.parse(_rs.path), '');
                return createFilterForARelation(_filter, path, _rs.service, req)
            })
        }, Promise.resolve(filter));
        return promise.then(_filter=>{
            return _filter;
        })
    }else{
        return Promise.resolve(filter);
    }
}

function createFilterForUser(_sd, filter, req) {
    if (_sd.relatedSchemas && _sd.relatedSchemas.internal && _sd.relatedSchemas.internal.users && _sd.relatedSchemas.internal.users.length > 0) {
        let promise = _sd.relatedSchemas.internal.users.reduce((acc, _rs) => {
            return acc.then(_filter => {
                let path = getSelect(JSON.parse(_rs.path), '');
                return createFilterForAUserUtil(_filter, path, req)
            })
        }, Promise.resolve(filter));
        return promise.then(_filter => {
            return _filter;
        })
    } else {
        return Promise.resolve(filter);
    }

}

function createFilterForAUserUtil(filter, path, req) {
    if(!filter) return Promise.resolve(filter);
    if (Array.isArray(filter)) {
        let promises = filter.map(_f => createFilterForAUserUtil(_f, path, req));
        return Promise.all(promises);
    }
    if (typeof filter === 'object') {
        let newFilter = {};
        let promises = Object.keys(filter).map(_k => {
            if (_k.startsWith(path)) {
                let newKey = _k.replace(new RegExp(`^(${path}.)`), "");
                return getUserIds({ [newKey]: filter[_k] }, req)
                    .then(_d => {
                        newFilter[path + '._id'] = { '$in': _d };
                    })
            } else {
                return createFilterForAUserUtil(filter[_k], path, req)
                    .then(_f => {
                        newFilter[_k] = _f;
                        return _f;
                    })
            }
        })
        return Promise.all(promises).then(() => {
            return newFilter;
        })
    }
    else {
        return Promise.resolve(filter);
    }
}

function getUserIds(filter, req) {
    return getUserDocuments('', filter, req)
        .then(docs => {
            return docs.map(_d => _d._id);
        })
}


function expandedShow(req, res, expand) {
    let id = req.swagger.params.id.value;
    let select = req.swagger.params.select.value;
    select = select ? select.split(',') : []
    let document = null;
    let selectionObject = null;
    let serviceDetailsObj = {};
    helperUtil.getServiceDetail(serviceId, req)
        .then(_sd => {
            selectionObject = getSelectionObject(_sd, select);
            let query = crudder.model.findOne({ "_id": id, "_metadata.deleted": false });
            if (selectionObject.querySelect.length > 0) {
                query = query.select(selectionObject.querySelect.join(' '));
            }
            return query.lean().exec()
        })
        .then(doc => {
            if (doc) {
                document = doc;
                let visitedDocs = {};
                visitedDocs[serviceId] = [id];
                return expandStoredRelation(serviceId, document, visitedDocs, selectionObject, req, expand,serviceDetailsObj,{})
            }
        })
        .then(() => {
            document ? res.json(document) : res.status(404).send();
        })
        .catch(err => {
            res.status(500).json({ message: err.message })
        })
}

/*
function generateFilter(schema, key, ids) {
	if (typeof schema === 'object' && Object.keys(schema)[0] === '_self') {
		if (typeof schema[Object.keys(schema)[0]] === 'object') {
			return embedObject(schema['_self'], '$elemMatch');
		} else {
			return `"${key}":{"$elemMatch":{"_id":{"$in": ${JSON.stringify(ids)}}}}`;
		}
	} else if (typeof schema === 'object') {
		let newKey = key == '' ? `${Object.keys(schema)[0]}` : `${key}.${Object.keys(schema)[0]}`;
		if (typeof schema[Object.keys(schema)[0]] === 'object') {
			let nextKey = Object.keys(schema[Object.keys(schema)[0]])[0];
			if (nextKey === '_self' && typeof schema[Object.keys(schema)[0]][nextKey] === 'object') {
				return embedObject(schema[Object.keys(schema)[0]], newKey);
			} else {
				return generateFilter(schema[Object.keys(schema)[0]], newKey);
			}
		} else {
			return `"${newKey}._id":{"$in": ${JSON.stringify(ids)}}`;
		}
	} else {
		return `{"$in": ${JSON.stringify(ids)}}`;
	}
}

function embedObject(schema, key, ids) {
	return typeof schema === 'object' ? `"${key}":{${generateFilter(schema, '')}}`: `"${key}._id":{${generateFilter(schema, '')}}`;
}
*/
function getExtIds(filter, service, req){
    return helperUtil.getServiceDetail(service, req)
       .then(_sd=>{
            let _service = {port: _sd.port, uri: "/"+_sd.app+_sd.api};
            if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
                    _service.port = 80;
                    _service.host = _sd.api.substr(1).toLowerCase() + "." + dataStackNS + "-" + _sd.app.toLowerCase().replace(/ /g, "");
            } else {
                _service.host = "localhost";
            }
            let qs = {
                "filter": JSON.stringify(filter),
                "select": "_id",
                "expand": true,
                "count": -1
            }
            return helperUtil.crudDocuments(_service, "get", null, qs, req)
       })
       .then(docs=>{
            return docs.map(_d => _d._id);
       })
}
/*
function getIdList(filterArr, req){
    let promises = filterArr.map(_fA => {
       return helperUtil.getServiceDetail(_fA.service, req)
       .then(_sd=>{
            let _service = {port: _sd.port, uri: "/"+_sd.app+_sd.api};
            if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
                    _service.port = 80;
                    _service.host = _sd.api.substr(1).toLowerCase() + "." + dataStackNS + "-" + _sd.app.toLowerCase().replace(/ /g, "");
            } else {
                _service.host = "localhost";
            }
            let qs = {
                "filter": JSON.stringify(_fA.filter),
                "select": "_id",
                "expand": true,
                "count": -1
            }
            return helperUtil.crudDocuments(_service, "get", null, qs, req)
       })
       .then(docs=>{
            let extIdList = docs.map(_d => _d._id);
            let intFilter = generateFilter(JSON.parse(_fA.path), '', extIdList);
            intFilter = JSON.parse('{' + intFilter + '}');
            return crudder.model.find(intFilter, "_id")
       })
       .then(_ds=>{
           return _ds.map(_d=>_d._id);
       })
    })
    return Promise.all(promises)
    .then(_ls=>{
        return [].concat.apply([], _ls)
    })
}
*/


function expandedIndex(req, res, expand) {
    let returnDocuments = [];
    let select = req.swagger.params.select.value;
    select = select ? select.split(',') : [];
    let selectionObject = null;
    let intFilter = null;
    let serviceDetailsObj = {};
    let sdd = {};
    let documentCache = {};
    helperUtil.getServiceDetail(serviceId, req)
        .then(_sd => {
            sdd = _sd;
            selectionObject = getSelectionObject(_sd, select);
            if (selectionObject.querySelect.length > 0) {
                req.swagger.params.select.value = selectionObject.querySelect.join(",");
            }
            let filter = req.swagger.params.filter.value;
            if (filter) {
                filter = typeof filter === 'string' ? JSON.parse(filter) : filter;
                intFilter = JSON.parse(JSON.stringify(filter));
                return createFilter(_sd, filter, req)
            }
            else {
                return Promise.resolve(filter);
            }
        })
        .then(_o => {
            let filter = req.swagger.params.filter.value;
            if (filter) {
                return createFilterForUser(sdd, _o, req);
            }
            else {
                return Promise.resolve(filter);
            }
        })
        .then(_o => {
            if (_o) {
                logger.debug(_o);
                req.swagger.params.filter.value = JSON.stringify(_o);
            }
            return crudderHelper.index(req, crudder.model);
        })
        .then(documents => {
            let promises = documents.map(doc => {
                let newDoc = doc;
                returnDocuments.push(newDoc);
                let visitedDocs = {};
                visitedDocs[serviceId] = [doc._id];
                return expandStoredRelation(serviceId, newDoc, visitedDocs, selectionObject, req, expand, serviceDetailsObj, documentCache)
            })
            return Promise.all(promises);
        })
        .then(() => {
            res.json(returnDocuments);
        })
        .catch(err => {
            logger.error(err);
            res.status(500).json({ message: err.message })
        });
}

function expandedCount(req, res, expand) {
    let intFilter = null;
    let sdd = {};
    helperUtil.getServiceDetail(serviceId, req)
        .then(_sd => {
            sdd = _sd;
            let filter = req.swagger.params.filter.value;
            if (filter) {
                filter = typeof filter === 'string' ? JSON.parse(filter) : filter;
                intFilter = JSON.parse(JSON.stringify(filter));
                return createFilter(_sd, filter, req)
            }
            else {
                return Promise.resolve(filter);
            }
        })
        .then(_o => {
            let filter = req.swagger.params.filter.value;
            if (filter) {
                return createFilterForUser(sdd, _o, req);
            }
            else {
                return Promise.resolve(filter);
            }
        })
        .then(_o => {
            if (_o) {
                logger.debug(_o);
                req.swagger.params.filter.value = JSON.stringify(_o);
            }
            return crudder.count(req, res);
        })
        .catch(err => {
            logger.error(err);
            res.status(500).json({ message: err.message })
        });
}

function getRelationVF(key, value, VFArray) {
    let obj = {};
    let idInclude = false;
    VFArray.forEach(_o => {
        if( _o.key == '_id') idInclude= true; 
        if(_o.properties && _o.properties._type == "Geojson"){
            obj[key + _o.key+'.userInput'] = value + _o.name+'.userInput';
            obj[key + _o.key+'.formattedAddress'] = value + _o.name+'.formattedAddress';
            obj[key + _o.key+'.geometry.type'] = value + _o.name+'.geometry.type';
            obj[key + _o.key+'.geometry.coordinates'] = value + _o.name+'.geometry.coordinates';
            obj[key + _o.key+'.town'] = value + _o.name+'.town';
            obj[key + _o.key+'.district'] = value + _o.name+'.district';
            obj[key + _o.key+'.state'] = value + _o.name+'.state';
            obj[key + _o.key+'.pincode'] = value + _o.name+'.pincode';
            obj[key + _o.key+'.country'] = value + _o.name+'.country';
        }
        else if(_o.properties && _o.properties._type == "File"){
            obj[key + _o.key+'._id'] = value + _o.name+'._id';
            obj[key + _o.key+'.filename'] = value + _o.name+'.filename';
            obj[key + _o.key+'.contentType'] = value + _o.name+'.contentType';
            obj[key + _o.key+'.length'] = value + _o.name+'.length';
            obj[key + _o.key+'.chunkSize'] = value + _o.name+'.chunkSize';
            obj[key + _o.key+'.uploadDate'] = value + _o.name+'.uploadDate';
            obj[key + _o.key+'.metadata.filename'] = value + _o.name+'.metadata.filename';
            obj[key + _o.key+'.md5'] = value + _o.name+'.md5';
        }
        else{
            obj[key + _o.key] = value + _o.name;
        }        
    })
    if(_.isEmpty(obj)){
        obj[key + '_id'] = value + '_id';
        obj[key + '_href'] = value + '_href';
    }
    else if(!idInclude){
        obj[key + '_id'] = value + '_id'; 
    }
    return obj;
}

function keyvalue(data, obj, keys, values,flag) {

    data.forEach(attribute => {
        let item = attribute.key;
        if(item == "_href")
            return;
        if (keys == undefined || values == undefined) {
            keys = ""; values = "";
        }
        if (attribute && attribute["properties"] && attribute["properties"]["relatedTo"]) {
            let newkeys = item + ".";
            let newValues = attribute["properties"]["name"] + ".";
            let newObj = getRelationVF(newkeys, newValues, attribute["properties"].relatedViewFields);
            Object.assign(obj, newObj);
        }
        else if (attribute["type"] == "Object" && attribute["properties"]) {
            keys = item + ".";
            values = attribute["properties"]["name"] + ".";

            keyvalue(attribute.definition, obj, keys, values,flag);
            keys = "";
            values = "";
        }
  
        else if (attribute["type"] == "Array" && flag) {
            if(attribute["definition"] && attribute["definition"][0] && attribute["definition"][0]["type"] == "Object"){
                keys += item+'.{index}.';
                values += attribute["properties"]["name"]+'.{index}.';
                keyvalue(attribute["definition"][0]["definition"], obj, keys, values,flag);
                keys = "";
                values = "";
            }
            else{
                keys += item+'.{index}';
                values += attribute["properties"]["name"]+'.{index}'
                obj[keys] = values; 
                keys = keys.replace(item+'.{index}', "");
            values = values.replace(attribute["properties"]["name"]+'.{index}', "");               
            }
            
        }
        else if (attribute["type"] == "Object") {
            // do nothing
        }
        else if (attribute["properties"]) {
            keys += item;
            values += attribute["properties"]["name"]
            obj[keys] = values;
            keys = keys.replace(item, "");
            values = values.replace(attribute["properties"]["name"], "");
        }
    });
    obj["_metadata.lastUpdated"] = "Last Updated";
    obj["_metadata.createdAt"] = "Created";
    return obj;

    // for (let item in data) {
    //     if (item == "_href") {
    //         return;
    //     }
    //     if (keys == undefined || values == undefined) {
    //         keys = ""; values = "";
    //     }

    //     if (data[item] && data[item]["properties"] && data[item]["properties"]["relatedTo"]) {
    //         let newkeys = item + ".";
    //         let newValues = data[item]["properties"]["name"] + ".";
    //         let newObj = getRelationVF(newkeys, newValues, data[item]["properties"].relatedViewFields);
    //         Object.assign(obj, newObj);
    //     }
    //     else if (data[item]["type"] == "Object" && data[item]["properties"]) {
    //         keys = item + ".";
    //         values = data[item]["properties"]["name"] + ".";

    //         keyvalue(data[item].definition, obj, keys, values,flag);
    //         keys = "";
    //         values = "";
    //     }
  
    //     else if (data[item]["type"] == "Array" && flag) {
    //         if(data[item]["definition"] && data[item]["definition"]["_self"] && data[item]["definition"]["_self"]["type"] == "Object"){
    //             keys += item+'.{index}.';
    //             values += data[item]["properties"]["name"]+'.{index}.';
    //             keyvalue(data[item]["definition"]["_self"]["definition"], obj, keys, values,flag);
    //             keys = "";
    //             values = "";
    //         }
    //         else{
    //             keys += item+'.{index}';
    //             values += data[item]["properties"]["name"]+'.{index}'
    //             obj[keys] = values; 
    //             keys = keys.replace(item+'.{index}', "");
    //         values = values.replace(data[item]["properties"]["name"]+'.{index}', "");               
    //         }
            
    //     }
    //     else if (data[item]["type"] == "Object") {
    //         // do nothing
    //     }
    //     else if (data[item]["properties"]) {
    //         keys += item;
    //         values += data[item]["properties"]["name"]
    //         obj[keys] = values;
    //         keys = keys.replace(item, "");
    //         values = values.replace(data[item]["properties"]["name"], "");
    //     }
        
    // }
    // obj["_metadata.lastUpdated"] = "Last Updated";
    // obj["_metadata.createdAt"] = "Created";
    // return obj;
}

function expandedExport(req, res, expand) {
    let returnDocuments = [];
    let finalObject = [];
    let uuids = uuid();
    let totalRecords = req.swagger.params.totalRecords.value;
    let select = req.swagger.params.select.value;
    let fileName = 'complex.csv';
    fileName = fileName.replace(/\//g, "_");
    let d = new Date();
    Number.prototype.padLeft = function(base,chr){
        var  len = (String(base || 10).length - String(this).length)+1;
        return len > 0? new Array(len).join(chr || '0')+this : this;
    }
    let formats = [(d.getDate()).padLeft(),(d.getMonth()+1).padLeft(),(d.getFullYear()-2000)].join('')+'-' +[d.getHours().padLeft(),d.getMinutes().padLeft(),d.getSeconds().padLeft()].join('');
    let downloadFile = 'complex-'+formats+'.zip';
    downloadFile = downloadFile.replace(/\//g, "_");
    select = select ? select.split(',') : [];
    let selectionObject = null;
    let intFilter = null;
    let obj = {};
    let obj2 = {};
    var resul = {};
    let definitionArr = helperUtil.getDefinition();
    var cbc = keyvalue(definitionArr, obj,null,null,false);
    var mapping = keyvalue(definitionArr, obj2,null,null,true);

    let serviceDetailsObj = {};

    res.status(200).json({_id: uuids, message: "Process queued" });
    let exportObj = {
        _id: uuids,
        status: "Pending",
        totalRecords: totalRecords,
        user: req.headers.user,
        type:"export",
        fileName: downloadFile,
        "_metadata": {
            "deleted": false,
            "lastUpdated": new Date(),
            "createdAt": new Date()
        }
    }
    return mongoose.connection.db.collection('complex.fileTransfers').insert(exportObj)
        .then(() => {
            return helperUtil.getServiceDetail(serviceId, req)
        })
        .then(_sd => {
            if (select.length > 0 && select[0][0] !== '-') {
                resul["_id"] = cbc["_id"];
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
            selectionObject = getSelectionObject(_sd, select);
            if (selectionObject.querySelect.length > 0) {
                req.swagger.params.select.value = selectionObject.querySelect.join(",");
            }
            let filter = req.swagger.params.filter.value;
            if (filter) {
                filter = typeof filter === 'string' ? JSON.parse(filter) : filter;
                intFilter = JSON.parse(JSON.stringify(filter));
                return createFilter(_sd, filter, req)
            }
            else {
                return Promise.resolve(filter);
            }
        })
        .then(_o => {
            if (_o) {
                logger.debug(_o);
                req.swagger.params.filter.value = JSON.stringify(_o);
            }
            return crudderHelper.count(req, crudder.model);
        })
        .then(count => {
            let arr = [];
            let totalBatches = count / BATCH;
            for (let i = 0; i < totalBatches; i++) {
                arr.push(i);
            }
            let promise = arr.reduce((_p, curr, i) => {
                return _p
                    .then(() => {
                        logger.info('Running batch ' + (i + 1));
                        req.swagger.params.page.value = (i + 1);
                        req.swagger.params.count.value = BATCH;
                        return crudderHelper.index(req, crudder.model);
                    })
                    .then(documents => {                        
                        return expandInBatch(documents, selectionObject, i, fileName, req,resul, serviceDetailsObj,finalObject)
                    })
            }, Promise.resolve());
            return promise
            .then(()=>{
                return secureFields.reduce((acc, curr) => {
                    return acc.then(_d => helperUtil.decryptArrData(_d, curr));
                }, Promise.resolve(finalObject));
            })
            .then((newFinalObject) => {
                const splitCount = 200;
                const segmentLength = Math.floor(newFinalObject.length / splitCount);
                const promiseArr = [];
                let promise;
                if (newFinalObject.length > splitCount) {
                    for (let i = 0; i < splitCount; i++) {
                        if (i === splitCount - 1) {
                            promiseArr.push(newFinalObject.map(e => flatten(e, true)));
                        } else {
                            promiseArr.push(newFinalObject.splice(i, segmentLength).map(e => flatten(e, true)));
                        }
                    }
                    promise = Promise.all(promiseArr)
                } else {
                    promiseArr.push(newFinalObject.map(e => flatten(e, true)));
                    promise = Promise.all(promiseArr)
                }
                promise.then(data => {
                    if (Array.isArray(data[0])) {
                        data = Array.prototype.concat.apply([], data);
                    }
                    return createExcel(fileName,data,mapping);
                })
                .then(() => {
                    zip.file(fileName, fs.readFileSync(fileName));
                    var data = zip.generate({ base64: false, compression: 'DEFLATE' });
                    fs.writeFileSync(downloadFile, data, 'binary');
                    fs.createReadStream(downloadFile).
                        pipe(global.gfsBucketExport.openUploadStream(crypto.createHash('md5').update(uuid() + global.serverStartTime).digest("hex"), {
                            contentType: "application/zip",
                            metadata: {
                                filename: downloadFile,
                                uuid: uuids
                            }
                        })).
                        on('error', function (error) {
                            logger.error(error);
                            return mongoose.connection.db.collection('complex.fileTransfers').updateOne({ _id: uuids }, { $set: { status: "Error", '_metadata.lastUpdated':  new Date() } })
                            .then(()=>{
                                informGW({ _id: uuids, status: "Error",userId: req.headers[global.userHeader] ,totalRecords: totalRecords})
                            })
                        }).
                        on('finish', function (file) {
                            logger.info('Uploaded file to mongo');
                            return mongoose.connection.db.collection('complex.fileTransfers').updateOne({ _id: uuids }, { $set: { status: "Completed", '_metadata.lastUpdated':  new Date() } })
                            .then(()=>{
                                informGW({_id: uuids, status: "Completed",userId: req.headers[global.userHeader], totalRecords: totalRecords,})
                            })
                        });
                }).catch(err => {
                        logger.error(err);
                    })
            })

        })
}

function expandInBatch(documents, selectionObject, count, fileName, req,resul, serviceDetailsObj,finalObject) {  
    let returnDocuments = [];
    let documentCache = {};  
    let promises = documents.map(doc => {
        let newDoc = doc;
        returnDocuments.push(newDoc);
        let visitedDocs = {};
        visitedDocs[serviceId] = [doc._id];
        return expandStoredRelation(serviceId, newDoc, visitedDocs, selectionObject, req, true,serviceDetailsObj, documentCache)
    })
    return Promise.all(promises)
        .then(() => {
            var options = {
                rename: Object.values(resul),
                headers: Object.keys(resul)
            }
            if (count > 0) {
                options.includeHeaders = false
            }
            if (count == 0) options.rename = Object.values(resul);
            returnDocuments.map(doc => {
                finalObject.push(doc);
            })
        })
}

function headerMapper(object, headers){
    let MappedValue = {};
    let split = [];
    Object.keys(object).forEach(key=>{
        if(key.includes('{index}')){
            split = key.split('{index}');
            headers.forEach(header=>{
                if(header.startsWith(split[0]) && header.endsWith(split[1])){
                    let value= object[key].replace('{index}',header.split(split[0])[1].split('.')[0]);
                    MappedValue[header] = value;
                }
            })   
        }
        else{
            MappedValue[key] = object[key];
        }
    })
    return MappedValue;
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
                                Object.assign(temp, flatten(item, deep, thisKey + '.' + i))
                            } else {
                                temp[thisKey + '.' + i] = item;
                            }
                        });
                    } else {
                        temp[thisKey] = obj[key];
                    }
                } 
                else if(obj[key] instanceof Date){
                    temp[thisKey] = obj[key]; 
                }
                else {
                    temp = Object.assign(temp, flatten(obj[key], deep, thisKey));
                }
            }
            else {
                if(typeof obj[key] =='boolean' ) obj[key] = obj[key].toString();
                if(!(parent && key == '_id' && typeof(obj[key])=="object"))temp[thisKey] = obj[key];  
            }
        });
        return temp;
    }
};


/*function createExcel(filename, data,mapping) {
    return new Promise((resolve, reject) => {
    const sheet = XLSX.utils.json_to_sheet(data, { dateNF: 'YYYY-MM-DD HH:MM:SS' });
    const abc = XLSX.utils.sheet_to_csv(sheet);
    let index = abc.indexOf('\n');
    let headers = abc.substring(0,index).split(','); 
    fs.writeFileSync(filename, replaceHeaders(headerMapper(mapping, headers),abc), 'utf8');
    resolve();
    })
}*/

function createExcel(filename, data,mapping) {
    return new Promise((resolve, reject) => {
    const sheet = XLSX.utils.json_to_sheet(data, { dateNF: 'YYYY-MM-DD HH:MM:SS' });
    const abc = XLSX.utils.sheet_to_csv(sheet);
    let index = abc.indexOf('\n');
    let headers = abc.substring(0,index).split(',');
    //fs.writeFileSync(filename, replaceHeaders(headerMapper(mapping, headers),abc), 'utf8');
    let writeStream = fs.createWriteStream(filename);
    writeStream.write(replaceHeaders(headerMapper(mapping, headers),abc));
    writeStream.on('finish', () => {
    logger.debug('wrote all data to file');
    resolve();
    });
    writeStream.end();
    })
}


function replaceHeaders(headers,file){
    Object.keys(headers).forEach(key=>{
        file = file.replace(key,headers[key]);  
    })
    return file;
}

function formDate(dateform){
    let date=new Date(dateform);
    let month = date.getMonth()+1;
    let meridian = 'AM';
    let hours = date.getHours();
    if(hours>12){
        hours = hours-12;
        meridian = 'PM'
    }
    date = date.getDate()+'-'+month+'-'+date.getFullYear()+' '+hours+':'+date.getMinutes()+':'+date.getSeconds()+' '+meridian
    return date;
}

function modifySecureFieldsFilter(filter, secureFields, secureFlag) {
    if (filter instanceof RegExp) return filter;
    let newSecurefield = secureFields.map(field=> field+'.value');
    if (Array.isArray(filter)) return filter.map(_f => modifySecureFieldsFilter(_f, secureFields, secureFlag));
    if (filter != null && typeof filter == 'object' && filter.constructor == {}.constructor) {
        let newFilter = {};
        Object.keys(filter).forEach(_k => {
            let newKey = _k;
            if (newSecurefield.indexOf(_k) > -1) {
                newKey = _k.split('.');
                newKey.pop();
                newKey = newKey.join('.');                
                newKey = newKey.startsWith('$') ? newKey : newKey + '.checksum';
                newFilter[newKey] = modifySecureFieldsFilter(filter[_k], secureFields, true);
            } else {
                newFilter[newKey] = modifySecureFieldsFilter(filter[_k], secureFields, secureFlag);
            }
        });
        return newFilter;
    }
    return secureFlag && typeof filter == 'string' ? crypto.createHash('md5').update(filter).digest("hex") : filter;
}

function customShow(req, res){
    let expand = req.swagger.params.expand.value;
    if(expand){
        return expandedShow(req, res, true);
    }else{
        crudder.show(req, res);
    }  
}

function customIndex(req, res){
    let expand = req.swagger.params.expand.value;
    let filter = req.swagger.params.filter.value;
    if(filter)
        req.swagger.params.filter.value = JSON.stringify(modifySecureFieldsFilter(JSON.parse(filter), secureFields, false));
    
    if(expand){
        return expandedIndex(req, res, true);
    }else{
        crudder.index(req, res);
    }
}

function customCount(req, res){
    let expand = req.swagger.params.expand.value;
    let filter = req.swagger.params.filter.value;
    if(filter)
        req.swagger.params.filter.value = JSON.stringify(modifySecureFieldsFilter(JSON.parse(filter), secureFields, false));
    
    if(expand){
        return expandedCount(req, res, true);
    }else{
        crudder.count(req, res);
    }
}

function customExport(req, res){
    let filter = req.swagger.params.filter.value;
    if(filter)
        req.swagger.params.filter.value = JSON.stringify(modifySecureFieldsFilter(JSON.parse(filter), secureFields, false));
    return expandedExport(req, res, false);
}

function roundMath(id, session, value, operation, field, precision, prevVersion) {
    let precisionFactor = Math.pow(10, precision);
    return crudder.model.aggregate([
        { $match: { _id: id } },
        {
            $project: {
                _id: 0,
                docVersion: '$_metadata.version.document',
                y: {
                    $divide: [
                        {
                            $subtract: [
                                {
                                    $add: [{ $multiply: [{ [operation]: [`$${field}`, value] }, precisionFactor] }, 0.5]
                                },
                                {
                                    $abs:{ $mod: [{ $add: [{ $multiply: [{ [operation]: [`$${field}`, value] }, precisionFactor] }, 0.5] }, 1]}
                                }
                            ]
                        }, precisionFactor]
                }
            }
        }
    ])
    // .session(session)
        .then(_a => {
            logger.debug(JSON.stringify({ _a, prevVersion }));
            if (!_a || !_a[0]) {
                throw new Error('Document not found');
            }
            if (_a && _a[0] && (prevVersion || prevVersion == 0) && prevVersion != _a[0]['docVersion']) {
                throw new Error('CUSTOM_READ_CONFLICT');
            }
            if (_a && _a[0]) {
                prevVersion = _a[0]['docVersion'];
            }
            logger.debug("new " + JSON.stringify({ _a, prevVersion }));
            return _a && _a[0] && (_a[0].y || _a[0].y === 0) ? { val: parseFloat(_a[0].y.toFixed(precision)) , prevVersion } : null;
        })
}

function math(req, res) {
    mathQueue.push({ req, res });
}

function processMathRequest(obj, cb) {
    obj.req.simulateFlag = false;
    let webHookData = null;
    let id = obj.req.swagger.params.id.value;
    let resData = null;
    obj.req.query.source = 'presave';
    obj.req.simulate = false;
    return doRoundMathAPI(obj.req, obj.res)
        .then(resBody => {
            resData = resBody;
            obj.res.json(resBody);
            cb();
        })
        .then(()=> {
            return getWebHookAndAuditData(obj.req, id, false)
        })
        .then(_d => {
            webHookData = _d;
            pushWebHookAndAuditData(webHookData, resData)
        })
        .catch(err => {
            logger.error(err.message);
            cb();
            if (err.message == 'CUSTOM_READ_CONFLICT' || (err.errmsg === "WriteConflict" && err.errorLabels && err.errorLabels.indexOf('TransientTransactionError') > -1)) {
                logger.error("=================");
                obj.req.simulateFlag = true;
                if(!obj.res.headersSent)
                    mathQueue.push({ req: obj.req, res: obj.res });
            } else {
                let status = err.name == 'ValidationError' ? 400 : 500;
                obj.res.status(status).json({ message: err.message });
            }
        })
}

function getUpdatedDoc(doc, updateObj) {
    Object.keys(updateObj).forEach(_k => {
        let keyArr = _k.split('.');
        keyArr.reduce((acc, curr, i) => {
            if (i == keyArr.length - 1) {
                acc[curr] = updateObj[_k];
            }
            if (acc) {
                return acc[curr];
            }
        }, doc);
    });
}

function doRoundMathAPI(req) {
    let id = req.swagger.params.id.value;
    let body = req.body;
    let updateBody = { '$inc': { '_metadata.version.document': 1 } };
    let session = null;
    let resBody = null;
    let prevVersion = null;
    let promise = Promise.resolve();
    // mongoose.startSession()
    //     .then((_s) => {
    //         session = _s;
    //         return session.startTransaction({ readConcern: { level: "majority" }, writeConcern: { w: "majority" } });
    //     });
    if (body["$inc"]) {
        promise = Object.keys(body["$inc"]).reduce((acc, curr) => {
            return acc.then(() => {
                let pField = precisionFields.find(_p => _p.field == curr);
                if (pField && (pField.precision || pField.precision == 0)) {
                    return roundMath(id, session, body["$inc"][curr], "$add", curr, pField.precision, prevVersion)
                        .then(_val => {
                            logger.debug({ _val });
                            if (_val) {
                                prevVersion = _val.prevVersion;
                                if (!updateBody['$set']) {
                                    updateBody['$set'] = {};
                                }
                                updateBody['$set'][curr] = _val.val;
                            }
                            return Promise.resolve();
                        })
                } else {
                    if (!updateBody['$inc']) {
                        updateBody['$inc'] = {};
                    }
                    updateBody['$inc'][curr] = body["$inc"][curr];
                    return Promise.resolve();
                }
            })
        }, promise)
    }
    if (body["$mul"]) {
        promise = Object.keys(body["$mul"]).reduce((acc, curr) => {
            return acc.then(() => {
                let pField = precisionFields.find(_p => _p.field == curr);
                if (pField && (pField.precision || pField.precision == 0)) {
                    return roundMath(id, session, body["$mul"][curr], "$multiply", curr, pField.precision, prevVersion)
                        .then(_val => {
                            if (_val) {
                                prevVersion = _val.prevVersion;
                                if (!updateBody['$set']) {
                                    updateBody['$set'] = {};
                                }
                                updateBody['$set'][curr] = _val.val;
                            }
                            return Promise.resolve();
                        })
                } else {
                    if (!updateBody['$mul']) {
                        updateBody['$mul'] = {};
                    }
                    updateBody['$mul'][curr] = body["$mul"][curr];
                    return Promise.resolve();
                }
            })
        }, promise)
    }
    const opts = { new: true };
    let generateId = false;
    let globalDoc = null;
    return promise.then(() => {
        if (updateBody['$set']) {
            return crudder.model.findOne({ _id: id })
                .then((_doc) => {
                    getUpdatedDoc(_doc, updateBody['$set']);
                    globalDoc = _doc;
                    return _doc.validate();
                })
                .then(()=>{
                    if(!req.simulateFlag)
                        return helperUtil.simulateDocs(globalDoc, generateId, req, 'PUT');

                    return globalDoc;
                })
                .then((_d) => {
                    logger.debug({ _id: id, '_metadata.version.document': prevVersion });
                    return crudder.model.findOneAndUpdate({ _id: id, '_metadata.version.document': prevVersion }, _d, opts);
                })
        }
    })
        .then(_newBody => {
            resBody = _newBody;
            if (!_newBody) {
                logger.debug({ _newBody });
                throw new Error('CUSTOM_READ_CONFLICT');
            }
            logger.debug(JSON.stringify({ resBody }));
        })
        .then(() => {
            return resBody;
        });
}

/*
function math(req, res) {
    let id = req.swagger.params.id.value;
    let body = req.body;
    if(!body["$inc"]) body["$inc"] = {};
    body["$inc"]["_metadata.version.document"] = 1;
    body["$set"] = {"_metadata.lastUpdated": new Date()};
    let webHookData = null;
    getWebHookAndAuditData(req, id)
        .then(_d => {
            webHookData = _d;
            return crudder.model.findOneAndUpdate({ "_id": id }, body, { runValidators: true, new: true });
        })
        .then(doc => {
            if (doc) {
                res.json(doc);
                pushWebHookAndAuditData(webHookData, doc.toJSON())
            } else {
                res.status(404).json({ message: "Document not found with id " + id });
            }
        })
        .catch(err => {
            res.status(500).json({ message: err.message })
        })
}
*/

function addExpireAt(req){
    let expireAt = null;
    if (req.swagger.params.expireAt && req.swagger.params.expireAt.value) {
        expireAt = req.swagger.params.expireAt.value;
        if (!isNaN(expireAt)) {
            expireAt = parseInt(req.swagger.params.expireAt.value)
        }
        expireAt = new Date(expireAt);
    } else if (req.swagger.params.expireAfter && req.swagger.params.expireAfter.value) {
        let expireAfter = req.swagger.params.expireAfter.value;
            let addTime = 0;
            let time = {
                s: 1000,
                m: 60000,
                h: 3600000
            }
            let timeUnit = expireAfter.charAt(expireAfter.length - 1);
            if (!isNaN(timeUnit)) addTime = parseInt(expireAfter) * 1000;
            else {
                let timeVal = expireAfter.substr(0, expireAfter.length - 1);
                if (time[timeUnit] && !isNaN(timeVal)) {
                    addTime = parseInt(timeVal) * time[timeUnit];
                } else {
                    res.status(400).json({ message: "expireAfter value invalid" });
                    return;
                }
            }
            expireAt = new Date().getTime() + addTime;
            expireAt = new Date(expireAt);
    }
    if (expireAt) {
        if (isNaN(expireAt.getTime())) {
            res.status(400).json({ message: "expire value invalid" });
            return;
        }
        if(Array.isArray(req.body)){
            let expString = expireAt.toISOString();
            req.body = req.body.map(_d=>{
                _d["_expireAt"] = expString;
            })
        }else{
            req.body["_expireAt"] = expireAt.toISOString();
        }
    }
}


function customUpdate(req, res) {
    if(req.body) delete req.body._metadata; 
    addExpireAt(req);
    return crudder.update(req, res);
}

let srvcD = {
    relatedSchemas: {"internal":{"users":[{"path":"{\"appUser\":\"User\"}","isRequired":true,"filter":"{ \"appUser._id\":\"{{id}}\"}"}]},"outgoing":[{"path":"{\"address\":\"Object\"}","service":"SRVC2007","isRequired":true}]},
    port: process.env.SERVICE_PORT || 20016,
    api: '/complex',
    app: 'Adam'
};
global.serviceInfo = JSON.parse(JSON.stringify(srvcD));

function enrichHrefForRelation(srvcId, path, document) {
    if(!document) return document;
    if (typeof path == 'string') {
        let id = document._id;
        return { _id: id, _href: global.outgoingAPIs[srvcId].url + '/' + id }
    } else if (path && {}.constructor == path.constructor) {
        let key = Object.keys(path)[0];
        if (key == '_self' && Array.isArray(document)) {
            let val = path[key];
            return document.map(_d => {
                return enrichHrefForRelation(srvcId, val, _d);
            })
        }
        else {
            let val = path[key];
            document[key] = enrichHrefForRelation(srvcId, val, document[key]);
        }
    }
    return document;
}

function enrichWithHref(document, req) {
    if (srvcD.relatedSchemas.outgoing) {
        srvcD.relatedSchemas.outgoing.forEach(_srv => {
            enrichHrefForRelation(_srv.service, JSON.parse(_srv.path), document)
        });
    }
    if (srvcD.relatedSchemas.internal && srvcD.relatedSchemas.internal.users) {
        srvcD.relatedSchemas.internal.users.forEach(_srv => {
            enrichHrefForRelation('USER', JSON.parse(_srv.path), document)
        });
    }
}

e.readiness = (req, res) => {
    if (mongoose.connection.readyState === 1) {
        if (runInit) {
            return init()
                .then(() => {
                    runInit = false;
                    res.end();
                })
                .catch(() => {
                    res.status(400).end();
                })
        }
        res.end();
    }
    else { res.status(400).end(); }
};

e.healthCheck = (req, res)=>{
    if (mongoose.connection.readyState === 1 && client && client.nc && client.nc.connected) {
		return res.status(200).json();
	}
	else {
		return res.status(400).json();
	}
};

function doTheMath(payload, id) {
    return new Promise((resolve, reject) => {
        if (payload['$inc'] || payload['$mul']) {
            let incKeys = payload['$inc'] ? Object.keys(payload['$inc']) : [];
            let mulKeys = payload['$mul'] ? Object.keys(payload['$mul']): [];
            let allKeys = _.uniq(incKeys.concat(mulKeys));
            if(!id){
                return reject('docId is null');
            }
            if (incKeys.length + mulKeys.length != allKeys.length) {
                reject('Cannot mul and inc same keys');
            }
            return crudder.model.findOne({ _id: id })
                .then(_data => {
                    _data = _data.toObject();
                    incKeys.forEach(_incK => {
                        _incK.split('.').reduce((acc, curr, i) => {
                            if (i === _incK.split('.').length - 1 && acc && typeof acc[curr] === 'number') {
                                return acc[curr] += payload['$inc'][_incK];
                            } else {
                                return acc ? acc[curr] : null
                            }
                        }, _data);
                    });
                    mulKeys.forEach(_mulK => {
                        _mulK.split('.').reduce((acc, curr, i) => {
                            if (i === _mulK.split('.').length - 1 && acc && typeof acc[curr] === 'number') {
                                return acc[curr] *= payload['$mul'][_mulK];
                            } else {
                                return acc ? acc[curr] : null
                            }
                        }, _data);
                    });
                    delete _data._metadata;
                    delete _data.__v;
                    return resolve(_data);
                });
        } else {
            delete payload._metadata;
            delete payload.__v;
            resolve(payload);
        }
    });
}

function simulateExpand(document, select, req){
    select = select ? select.split(',') : [];
    let selectionObject = null;
    let serviceDetailsObj = {};
    helperUtil.getServiceDetail(serviceId, req)
        .then(_sd => {
            selectionObject = getSelectionObject(_sd, select);
            let visitedDocs = {};
            if(document._id) visitedDocs[serviceId] = [document._id];
            return expandStoredRelation(serviceId, document, visitedDocs, selectionObject, req, true, serviceDetailsObj, {})
        })
        .then(() => {
            return document;
        })
}

function simulateDoc(req, res){
    let generateId = req.swagger.params.generateId.value;
    let operation = req.swagger.params.operation.value;
    let docId = req.swagger.params.docId.value;
    if(operation=='GET'){
        let select = req.swagger.params.select.value;
        return simulateExpand(req.body, select, req)
            .then(docs=>{
                res.json(docs);
            })
            .catch(err=>{
                logger.error(err);
                res.json({ message: err.message });
            });
    }
    return doTheMath(req.body, docId)
    .then(_d => helperUtil.simulateDocs(_d, generateId, req, operation))
    .then(_d => {
        let status = 200;
        if(Array.isArray(_d)){
            if(_d.some(_a=>_a._error)){
                status = 400;
            }
        }else{
            if(_d._error) status = 400;
        }
        res.status(status).json(_d);
    })
    .catch(err => {
        logger.error(err);
        res.status(500).json({message: err.message});
    })
}

function lockDocument(req, res){
    let promise = null;
    if(Array.isArray(req.body)){
        let promises = req.body.map(_d=>{
            return crudder.model.findOneAndUpdate({_id:_d.id},{'_metadata.workflow': _d.wfId},{new: true});
        })
        promise = Promise.all(promises);
    }else{
        if(req.body.id)    
            promise = crudder.model.findOneAndUpdate({_id:req.body.id},{'_metadata.workflow': req.body.wfId},{new: true});
        else{
            promise = Promise.reject(new Error('id not found'));
        }    
    }
    promise.then(_d=>{
        res.json(_d);
    })
    .catch(err=>{
        res.status(500).json({message: err.message});
    })
}

function experienceHookData(req,res){
    let name=req.swagger.params.name.value;
    let hookUrl=helperUtil.getExperienceHook(name);
    if(!hookUrl){
        return res.status(400).json({message: 'Invalid Id'});
    }
        if(!req.body.data)
            return res.status(400).json({ message: 'Invalid Request' });
        var options = {
            url: hookUrl.url,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: {data: req.body.data,
                txnId: req.headers[global.txnIdHeader],
                user: req.headers[global.userHeader],
                dataService: process.env.SERVICE_ID || 'SRVC2006'
            },
            json: true
        };
        request.post(options, function (err, resp, body) {
            if (err) {
                logger.error("Error requesting Experience Hook");
                return res.status(500).json({ message: 'Error while requesting hook' });
            } else if (!resp) {
                logger.error("Experience Hook down");
                return res.status(404).json({ message: 'Unable to connect to Hook Url' });
            }
            else {
                let errMessage = hookUrl.errorMessage;
                if(resp.statusCode>=400){
                    if(body.message) errMessage = body.message;
                    return res.status(resp.statusCode).json({message: errMessage});
                }
                return res.status(resp.statusCode).json(body);
            }
        });
    }


function getSecuredFields(req, res){
    res.json(secureFields);
}

function customCreate(req, res){
    if(req.body) delete req.body._metadata;
    addExpireAt(req);
    crudder.create(req, res);
}


    function removeDocument(doc, req, type) {
        return new Promise(resolve => {
            if (type == "markAsDeleted") {
                doc._metadata.deleted = true;
                doc.save(req)
                    .then(doc => {
                        resolve(doc);
                    })
                    .catch(err => resolve(null));
            } else {
                doc.remove(req)
                    .then(() => {
                        resolve(doc.toObject());
                    })
                    .catch(err => resolve(null));
            }
        });
    }
    
    e.bulkMarkAsDeleted = (req,res) => {
        bulkRemove(req, res,'markAsDeleted');
    }
    
    e.bulkDestroy = (req,res) =>{
        bulkRemove(req, res,'destroy');
    }
    
    function bulkRemove(req, res,type){
    
        let document = null;
        var ids = req.body.ids;
        const deleteBatch = 30;
        let rmDocs = [];
        return crudder.model.find({
            '_id': { "$in": ids },
            '_metadata.deleted': false
        })
            .then(docs => {
                let arr = [];
                let totalBatches = docs.length / deleteBatch;
                for (let i = 0; i < totalBatches; i++) {
                    arr.push(i);
                }
                let promise = arr.reduce((_p, curr, i) => {
                    return _p
                        .then(() => {
                            let doc = docs.slice(i * deleteBatch, (i + 1) * deleteBatch);
                            let removePromise = doc.map(doc => removeDocument(doc, req, type));
                            return Promise.all(removePromise);
                        })
                        .then(data => {
                            data.map(doc => rmDocs.push(doc));
                        })
                }, Promise.resolve());
    
                promise.then(() => {
                    let removedDocs = rmDocs.filter(doc => doc != null);
                    let removedIds = removedDocs.map(doc => doc._id);
                    let docsNotRemoved = _.difference(_.uniq(ids), removedIds);
                    if (_.isEmpty(docsNotRemoved))
                        return res.status(200).json({});
                    else {
                        return res.status(400).json({ "message": "Could not delete document with id " + docsNotRemoved });
                    }
                })
            })
            .catch(err => {
                return err;
            });
    }

    e.exportDetails = (req,res) =>{
        let filter = {};
        if(req.swagger.params.filter.value) filter = JSON.parse(req.swagger.params.filter.value);
        let user = req.headers.user;
        filter['user'] = user
        req.swagger.params.filter.value =  JSON.stringify(filter);   
        exportCrudder.index(req,res);
    }

    e.exportDetailsCount = (req,res) => {
        let filter = {};
        if(req.swagger.params.filter.value) filter = JSON.parse(req.swagger.params.filter.value);
        let user = req.headers.user;
        filter['user'] = user
        req.swagger.params.filter.value =  JSON.stringify(filter);   
        exportCrudder.count(req,res);
    }

    e.exportDetailsDelete = (req,res)=>{
        exportCrudder.destroy(req,res);
    }

    function informGW(data){
        var options = {
            url: 'http://localhost:9080/gw/fileStatus/export',
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            json: true,
            body: data
        };
        request.put(options, function (err, res) {
            if (err) {
                logger.error(err.message);
            }
        });
    
    }

    function updateHref(req, res){
        global.outgoingAPIs[req.body.id] = req.body;
        res.json({message: 'Href Updated'});
    }

    module.exports = {
        create:customCreate,
        index:customIndex,
        show:customShow,
        destroy:crudder.destroy,
        exportAll: customExport,
        update:customUpdate,
        count:customCount,
        math: math,
        bulkShow:crudder.bulkShow,
        bulkDelete:e.bulkDestroy,
        fileUpload: e.fileUpload,
        fileView: e.fileView,
        fileDownload: e.fileDownload,
        exportedFileDownload: e.exportedFileDownload,
        exportDetails:e.exportDetails,
        exportDetailsCount:e.exportDetailsCount,
        exportDetailsDelete:e.exportDetailsDelete,
        doc: e.doc,
        simulate: simulateDoc,
        lockDocument: lockDocument,
        experienceHookData: experienceHookData,
        healthCheck: e.healthCheck,
        readiness: e.readiness,
        securedFields: getSecuredFields,
        requiredRelation:requiredRelation,
        aggregate: crudder.aggregate,
        updateHref: updateHref
    };
    