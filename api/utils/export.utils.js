const _ = require('lodash');

let commonUtils = require('./common.utils')
let config = require('./../../config');

var e = {}

var logger = global.logger;

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


function createFilterForARelation(filter, path, service, req) {
    if (Array.isArray(filter)) {
        let promises = filter.map(_f => createFilterForARelation(_f, path, service, req));
        return Promise.all(promises);
    }
    if (filter!=null && typeof filter === 'object') {
        let newFilter = {};
        let promises = Object.keys(filter).map(_k => {
            if (_k.startsWith(path)) {
                if(filter[_k] == null || filter[_k] == undefined){
                    newFilter[path + '._id'] = { $exists: false };
                    return Promise.resolve();
                } else {
                    let newKey = _k.replace(new RegExp(`^(${path}.)`), "");
                    return getExtIds({ [newKey]: filter[_k] }, service, req)
                        .then(_d => {
                            newFilter[path + '._id'] = { '$in': _d };
                        })
                }
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

function getExtIds(filter, service, req){
    return commonUtils.getServiceDetail(service, req)
       .then(_sd=>{
            let _service = {port: _sd.port, uri: "/"+_sd.app+_sd.api};
            if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
                    _service.port = 80;
                    _service.host = _sd.api.substr(1).toLowerCase() + "." + odpNS + "-" + _sd.app.toLowerCase().replace(/ /g, "");
            } else {
                _service.host = "localhost";
            }
            let qs = {
                "filter": JSON.stringify(filter),
                "select": "_id",
                "expand": true,
                "count": -1
            }
            return commonUtils.crudDocuments(_service, "get", null, qs, req)
       })
       .then(docs=>{
            return docs.map(_d => _d._id);
       })
}

e.getSelectionObject = function(_sd, select, deepExpand = true) {
    let querySelect = [];
    let extSelect = [];
    let userSel = [];
    if ((_sd.relatedSchemas && _sd.relatedSchemas.outgoing && _sd.relatedSchemas.outgoing.length > 0) || (_sd.relatedSchemas && _sd.relatedSchemas.internal && _sd.relatedSchemas.internal.users && _sd.relatedSchemas.internal.users.length > 0)) {
        if (_sd.relatedSchemas && _sd.relatedSchemas.outgoing && _sd.relatedSchemas.outgoing.length > 0) {
            _sd.relatedSchemas.outgoing.forEach(_rs => {
                // extSelect.push({ service: _rs.service, "field": [] });
                let pathSelect = getSelect(JSON.parse(_rs.path), '');
                if (select.length == 0 && deepExpand) extSelect.push({ service: _rs.service, "field": [], path: _rs.path });
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
                    }  else if(_sel === pathSelect || pathSelect.startsWith(_sel + '.')) {
                        querySelect.push(_sel);
                        let selObj = extSelect.find(_e => _e.service == _rs.service && _e.path == _rs.path);
                        if (!selObj) extSelect.push({ service: _rs.service, "field": [], path: _rs.path });
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

e.createFilter = function (_sd, filter, req) {
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


e.expandInBatch = function(documents, selectionObject, count, fileName, req,resul, serviceDetailsObj, options) {
    logger.info('log details in export Utils :: ', logger.level)
    let serviceId = config.serviceId;
    let returnDocuments = [];
    let documentCache = {};  
    let promises = documents.map(doc => {
        let newDoc = doc;
        returnDocuments.push(newDoc);
        let visitedDocs = {};
        visitedDocs[serviceId] = [doc._id];
        return expandStoredRelation(serviceId, newDoc, visitedDocs, selectionObject, req, true,serviceDetailsObj, documentCache, options)
    })
    return Promise.all(promises)
        .then(() => {
            return Promise.resolve(returnDocuments)
        })
}

function expandStoredRelation(serviceId, document, visitedDocs, selectionObject, req, deepExpand, serviceDetailsObj, documentCache, options) {
    let srvcObj = {};
    return commonUtils.getStoredServiceDetail(serviceId, serviceDetailsObj, req)
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
                        let path = Object.keys(JSON.parse(_rs.path))[0];
                        if(!document[path]){ return Promise.resolve(document);}
                        return enrichForARelationCache(_rs.service, JSON.parse(_rs.path), document, newSelectionObject.querySelect, documentCache, serviceDetailsObj, visitedDocs, req, deepExpand, options);
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

function enrichForARelationCache(srvcId, path, document, select, documentCache, serviceDetailsCache, visitedDocs, req, deepExpand, options) {
    if(!document) return Promise.resolve(document);
    if (typeof path == 'string') {
        let id = document._id;
        if(!id) return Promise.resolve(id);
        if (visitedDocs[srvcId] && visitedDocs[srvcId].indexOf(id) > -1) return Promise.resolve(document);
        // if select has only _href or _id no need to expand;
        if (select.length > 0 && !select.some(_s => ['_id', '_href'].indexOf(_s) == -1)) {
            return Promise.resolve(document);
        }
        let newSelectionObject;
        return commonUtils.getStoredServiceDetail(srvcId, serviceDetailsCache, req)
            .then(_sd => {
                newSelectionObject = getSelectionObject(_sd, select, deepExpand);
                return fetchExtData(id, srvcId, newSelectionObject.querySelect.join(','), documentCache, serviceDetailsCache, req, options)
            })
            .then(_d => {
                if(deepExpand || newSelectionObject.extSelect.length || newSelectionObject.userSel.length) {
                    if(!visitedDocs[srvcId]) visitedDocs[srvcId] = [];
                    (visitedDocs[srvcId]).push(_d._id);
                    return expandStoredRelation(srvcId, _d, visitedDocs, newSelectionObject, req, deepExpand, serviceDetailsCache, documentCache, options);
                } else 
                    return Promise.resolve(_d);
            })
    } else if (path && {}.constructor == path.constructor) {
        let key = Object.keys(path)[0];
        if (key == '_self' && Array.isArray(document)) {
            let val = path[key];
            let promises =  document.map(_d => {
                return enrichForARelationCache(srvcId, val, _d, select, documentCache, serviceDetailsCache, visitedDocs, req, deepExpand, options);
            })
            return Promise.all(promises);
        }
        else {
            let val = path[key];
            return enrichForARelationCache(srvcId, val, document[key], select, documentCache, serviceDetailsCache, visitedDocs, req, deepExpand, options)
                .then(_d => {
                    document[key] = _d;
                    return document;
                })
        }
    }
    return document;
}

function fetchExtData(id, serviceId, select, documentCache, serviceDetailCache, req, options) {

    if (documentCache[`${serviceId}##${id}##${select}`]) {
        return documentCache[`${serviceId}##${id}##${select}`];
    }
    documentCache[`${serviceId}##${id}##${select}`] = commonUtils.getStoredServiceDetail(serviceId, serviceDetailCache, req)
        .then(_sd => {
            let _service = { port: _sd.port, uri: "/api/c/" + _sd.app + _sd.api };
            if (process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT) {
                _service.port = 80;
                _service.host = "gw." + odpNS;
            } else {
                _service.port = 9080;
                _service.host = "localhost";
            }
            let qs = {
                "filter": JSON.stringify({ _id: id }),
                "select": select,
                "count": 1
            }
            if(options && options.forFile) qs['forFile'] = options.forFile;
            return commonUtils.crudDocuments(_service, "get", null, qs, req)
                .then(_d => {
                    if(_d && _d[0]) {
                        delete _d[0]._metadata;
                        delete _d[0].__v;
                        return _d[0];
                    } else {
                        throw new Error(id + " doesn't exist");
                    }
                }).catch(err => {
                    logger.error('Error in fetching ext. data:: ', err);
                    return Promise.resolve({ _id: id, _errMessage: err.message });
                })
        });
    return documentCache[`${serviceId}##${id}##${select}`];

}


module.exports = e;