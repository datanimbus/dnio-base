'use strict';

const mongoose = require('mongoose');
const log4js = require('log4js');
let definition = require('../helpers/bulkCreate.definition.js').definition;
const SMCrud = require('@appveen/swagger-mongoose-crud');
const schema = new mongoose.Schema(definition, {timestamps: true});

schema.index({createdAt: 1},{expireAfterSeconds: 3600});
const logger = log4js.getLogger(global.loggerName);
var options = {
	logger: logger,
	collectionName: 'complex.bulkCreate'
};
const helperUtil = require('../helpers/util.js');
const _ = require('lodash');
const XLSX = require('xlsx');
const request = require('request');
const envConfig = require('../../config.js');
// const isDev = process.env.DEV;
const serviceId = process.env.SERVICE_ID || 'SRVC2006';
let e = {};

// function swap(json) {
// 	var ret = {};
// 	for (var key in json) {
// 		ret[json[key]] = key;
// 	}
// 	return ret;
// }

var crudder = new SMCrud(schema, 'bulkCreate', options);

function modifyFilterForBulkCreate(req) {
	let filter = req.swagger.params.filter.value;
	let fileId = req.swagger.params.fileId.value;
	if (filter && typeof filter === 'string') {
		filter = JSON.parse(filter);
	}
	if (filter && typeof filter === 'object') {
		filter.fileId = fileId;
	} else {
		filter = {
			fileId
		};
	}
	req.swagger.params.filter.value = JSON.stringify(filter);
}

e.fileMapperList = (req, res) => {
	modifyFilterForBulkCreate(req);
	crudder.index(req, res);
};

e.fileMapperCount = (req, res) => {
	modifyFilterForBulkCreate(req);
	crudder.count(req, res);
};

// function expandKey(key, value) {
// 	let json = {};
// 	let splitArr = key.split('.');
// 	if (splitArr.length === 1) {
// 		json[key] = value;
// 	} else {
// 		let newKey = splitArr[0];
// 		splitArr.splice(0, 1);
// 		json[newKey] = expandKey(splitArr.join('.'), value);
// 	}
// 	return json;
// }

// function isObject(obj) {
// 	return typeof obj === 'object';
// }

// function mergeDeep(target, source) {
// 	let output = Object.assign({}, target);
// 	if (isObject(target) && isObject(source)) {
// 		Object.keys(source).forEach(key => {
// 			if (isObject(source[key])) {
// 				if (!(key in target))
// 					Object.assign(output, {
// 						[key]: source[key]
// 					});
// 				else
// 					output[key] = mergeDeep(target[key], source[key]);
// 			} else {
// 				Object.assign(output, {
// 					[key]: source[key]
// 				});
// 			}
// 		});
// 	}
// 	return output;
// }

// function expandJson(json) {
// 	let newObj = {};
// 	Object.keys(json).forEach(key => {
// 		let expandedObj = expandKey(key, json[key]);
// 		newObj = mergeDeep(newObj, expandedObj);
// 	});
// 	return newObj;
// }

// function flatenJson(oldJson, newJson, key) {
// 	Object.keys(oldJson).forEach(_k => {
// 		let newKey = key == '' ? _k : key + '.' + _k;
// 		if (geoJSONFields.indexOf(newKey) > -1){
// 			newJson[newKey] = oldJson[_k] && oldJson[_k].userInput ? oldJson[_k].userInput : null;
// 		}
// 		else if (oldJson[_k] != null && typeof oldJson[_k] === 'object') {
// 			flatenJson(oldJson[_k], newJson, newKey);
// 		} else {
// 			newJson[newKey] = oldJson[_k];
// 		}
// 	});
// }

function getConflictData(_dataArr, isHeaderProvided, model, validAfterConflict) {
	let dataId = _dataArr.map(obj => (obj.data && obj.data._id) ? obj.data._id : null);
	dataId = dataId.filter(_d => _d);
	let duplicateIds = [];
	let valid = [];
	let promise = dataId.length > 0 ? model.find({ '_id': { '$in': dataId } }, '_id') : Promise.resolve([]);
	return promise
		.then(docs => {
			let conflictIds = [];
			if (docs) {
				conflictIds = docs.map(obj => obj._id);
				// docs.forEach(e=>conflictDataArrNew.push(e));
			}
			// if(conflictIds.length>100) throw new Error('CONFLICT_MORE_THAN_100');
			let idList = [];
			let conflictArr = [];
			// let sNo = isHeaderProvided ? 1 : 0;
			// let confObj = null;
			_dataArr.forEach(obj => {
				let newObj = {};
				// sNo++;
				let flag = false;
				newObj.data = JSON.parse(JSON.stringify(obj.data));
				newObj.sNo = obj.sNo;
				if (obj.data && obj.data._id && idList.indexOf(obj.data._id) > -1) {
					newObj.status = 'Duplicate';
					duplicateIds.push(obj.data._id);
					flag = true;
				}
				if (obj.data && obj.data._id && conflictIds.indexOf(obj.data._id) > -1) {
					newObj.conflict = true;
					flag = true;
				}
				if (obj.data && obj.data._id) idList.push(obj.data._id);
				if (flag) {
					conflictArr.push(newObj);
				} else {
					valid.push(newObj);
				}
			});
			valid.forEach(_data => {
				if (duplicateIds.indexOf(_data.data._id) > -1) {
					_data.status = 'Duplicate';
					conflictArr.push(JSON.parse(JSON.stringify(_data)));
				}else{
					validAfterConflict.push(_data);
				}
			});
			return conflictArr;
		});
}


// function validationPromise(sNo, model, data, errorData, req, operation) {
// 	return new Promise((resolve) => {
// 		req.query.source = 'fileMapper';
// 		return helperUtil.enrichDataWithPreHooks(data, req, operation ? operation : 'POST')
// 			.then(_d => {
// 				let modelData = new model(_d);
// 				modelData.validate(function (err) {
// 					if (err) {
// 						if (!(err.errors && err.errors._id && err.errors._id.kind === 'unique')) {
// 							errorData.push({
// 								data: data,
// 								error: err.message,
// 								sNo: sNo
// 							});
// 						}
// 					}
// 					resolve(data);
// 				});
// 			})
// 			.catch(err=>{
// 				errorData.push({
// 					data: data,
// 					error: err.message,
// 					sNo: sNo
// 				});
// 				resolve(data);
// 			});
// 	});
// }

function createDocPromise(_req, model, data, sNo, errorData, fileId) {
	return new Promise((resolve) => {
		let modelData = new model(data);
		modelData._metadata.filemapper = fileId;
		modelData._metadata.createdAt = new Date();
		modelData.save(_req, function (err) {
			if (err) {
				errorData.push({
					data: data,
					error: err.message
				});
				return crudder.model.updateOne({ fileId: fileId, sNo }, { $set: { status: 'Error' } })
					.then(() => resolve(null));
			} else {
				return crudder.model.updateOne({ fileId: fileId, sNo }, { $set: { status: 'Created' } })
					.then(() => resolve(data));
			}
		});
	});
}

function updateDocPromise(_req, dataModel, newData, sNo, fileId) {
	return new Promise((resolve) => {
		if (newData) {
			delete newData._v;
			delete newData._id;
			Object.assign(dataModel, newData);
			let saveData = null;
			return dataModel.save(_req)
				.then(_d => {
					saveData = _d;
					return crudder.model.updateOne({ fileId: fileId, sNo }, { $set: { status: 'Updated' } });
				})
				.then(() => resolve(saveData))
				.catch(() => {
					// errorData.push({
					// 	data: newData,
					// 	error: err.message
					// });
					return crudder.model.updateOne({ fileId: fileId, sNo }, { $set: { status: 'Error' } })
						.then(() => resolve(null));
				});
		}
	});
}


function getGeoDetails(geoKey, addr) {
	var options = {
		url: 'https://maps.googleapis.com/maps/api/geocode/json',
		method: 'GET',
		qs: {
			address: addr,
			key: envConfig.googleKey
		}
	};
	return new Promise((resolve, reject) => {
		request.get(options, function (err, res, body) {
			if (err) {
				logger.error('Error requesting Google API');
				reject(err);
			} else if (!res) {
				logger.error('Google API service is down');
				reject(new Error('Google API service is down'));
			} else {
				if (res.statusCode === 200) {
					body = JSON.parse(body);
					let geoObj = {};
					geoObj.geometry = {};
					geoObj.geometry.type = 'Point';
					geoObj.userInput = addr;
					let aptLocation = null;
					if (_.isEmpty(body.results[0]))
						return resolve({key: geoKey, geoObj: {userInput: addr}});
					else {
						aptLocation = !_.isEmpty(body.results) && !_.isEmpty(body.results[0]) ? body.results[0] : null;
						const typeMapping = {
							'locality' : 'town',
							'administrative_area_level_2' : 'district',
							'administrative_area_level_1' : 'state',
							'postal_code':'pincode',
							'country': 'country'
						};
						if(aptLocation){
							let addrComp = aptLocation.address_components;
							Object.keys(typeMapping).forEach(_k=>{
								let temp = addrComp.find(_c => _c.types && _c.types.indexOf(_k)>-1);
								if(temp) geoObj[typeMapping[_k]] = temp.long_name;
							});
							geoObj.geometry.coordinates = [aptLocation.geometry.location.lng, aptLocation.geometry.location.lat];
						}
						let resObj = {};
						resObj.key = geoKey;
						resObj.geoObj = geoObj;
						resolve(resObj);
					}
				} else {
					return resolve({
						key: geoKey,
						geoObj: {
							userInput: addr
						}
					});
				}
			}
		});
	});
}

function expandGeoJsonRecurssive(path, dataJson){
	let pathSplit = path.split('.');
	let key = pathSplit.shift();
	if(key && dataJson[key]){
		if(Array.isArray(dataJson[key])){
			let promises = dataJson[key].map(_d=>expandGeoJsonRecurssive(pathSplit.join('.'), _d));
			return Promise.all(promises)
				.then(_d=>{
					dataJson[key] = _d;
					return dataJson;
				});
		}else if(dataJson[key].constructor == {}.constructor){
			return expandGeoJsonRecurssive(pathSplit.join('.'), dataJson[key])
				.then(_d=>{
					dataJson[key] = _d;
					return dataJson;
				});
		}else{
			return getGeoDetails(path, dataJson[key])
				.then(_loc => {
					dataJson[key] = _loc.geoObj;
					return dataJson;
				});
		}
	}else if(!key){
		if(Array.isArray(dataJson)){
			let promises = dataJson.map(_d=>{
				return getGeoDetails(path, _d)
					.then(_loc => {
						return _loc.geoObj;
					});
			});
			return Promise.all(promises);
		}else{
			return getGeoDetails(path, dataJson)
				.then(_loc => {
					return _loc.geoObj;
				});
		}
	}else{
		return Promise.resolve(dataJson);
	}
}

function enrichSchemaWithGeoDetails(schemaJson) {
	return geoJSONFields.reduce((_p, _c) => {
		return _p.then((_d) => {
			return expandGeoJsonRecurssive(_c, _d);
		});
	}, Promise.resolve(schemaJson));
}

let geoJSONFields = 'location'.split(',').filter(_k => _k != '');

function objectMapping(sheetJson, mapping){
	let newDoc = {};
	if (!mapping) return;
	if(mapping && mapping.constructor == {}.constructor){
		Object.keys(mapping).forEach(_k=>{
			if(typeof mapping[_k] == 'string'){
				newDoc[_k] = sheetJson[mapping[_k]];
			}else if(Array.isArray(mapping[_k])){
				newDoc[_k] = mapping[_k].map(_o=>{
					return objectMapping(sheetJson, _o);
				});
				newDoc[_k] = newDoc[_k].filter(_d=>_d);
			}else{
				newDoc[_k] = objectMapping(sheetJson, mapping[_k]);
			}
		});
	}else if(typeof mapping == 'string'){
		return sheetJson[mapping];
	}
	if(newDoc && Object.keys(JSON.parse(JSON.stringify(newDoc))).length>0){
		return newDoc;
	}       
	return;
}

function substituteMappingSheetToSchema(sheetArr, headerMapping){
	return sheetArr.map(obj => objectMapping(obj, headerMapping));
}

function enrichSchemaArray(schemaJson) {
	let enrichedSchemaArr = [];
	var arrays = [],
		size = 20;
	while (schemaJson.length > 0) {
		arrays.push(schemaJson.splice(0, size));
	}
	return arrays.reduce((_p, _c) => {
		return _p.then(() => {
			return Promise.all(_c.map(ob=>enrichSchemaWithGeoDetails(ob)))
				.then(_dArr=>{
					_dArr.forEach(_d=>{
						if (_d) enrichedSchemaArr.push(_d);
					});
				});
		});
	}, Promise.resolve())
		.then(() => {
			return enrichedSchemaArr;
		});
}

function fileMapperValidation(data, model, _sd, sNo, validData, errorData, invalidSNo, req) {
	return new Promise((resolve, reject) => {
		req.query.source = 'fileMapper';
		if (invalidSNo.indexOf(sNo) > -1) reject(new Error('Insufficient user privilege'));
		// delete data._id; // Removed this code so that conflict occurs
		let modelData = new model(data);
		modelData.isNew = false; // Added this so that it dosen't go to Error
		logger.debug('modelData -- ', modelData);
		modelData.validate().then(() => {
			return helperUtil.enrichDataWithPreHooks(modelData.toObject(), req, 'POST')
				.then(_d => {
					let newObj = Object.assign({}, JSON.parse(JSON.stringify(data)), _d);
					// delete newObj._id; // Removed this code so that conflict occurs
					logger.debug('newObj --- ', newObj);
					let modelData = new model(newObj);
					modelData.isNew = false;
					return modelData.validate()
						.then(() => {
							return helperUtil.validateReferenceIds(modelData, {}, {}, req);
						})
						.then(() => resolve(modelData))
						.catch(err => reject(err));
				})
				.catch(err => reject(err));
		})
			.catch(err => reject(err));
	})
		.then(data => validData.push({ data: data, sNo: sNo }))
		.catch(err => {
			errorData.push({ data: data, sNo: sNo, errorMessage: err.message });
		});
}

function processValidation(arr, batch, model, serviceDetail, validData, errorData, invalidSNo, _req){
	var arrays = [],
		size = batch;
	while (arr.length > 0) {
		arrays.push(arr.splice(0, size));
	}
	logger.debug('Validating data in batch of ' + batch);
	return arrays.reduce((_p, _c, i) => {
		return _p.then(() => {
			if (errorData.length > 100) throw new Error('ERROR_MORE_THAN_100');
			logger.debug('Running batch '+(i+1));
			let validationPromiseArr = _c.map(obj => {
				return fileMapperValidation(obj.data, model, serviceDetail, obj.sNo, validData, errorData, invalidSNo, _req);
			});
			return Promise.all(validationPromiseArr);
		});
	}, Promise.resolve());
}

function getSheetData(ws, isHeaderProvided) {
	if (!ws['!ref']) return [];
	let sheetArr = null;
	if (isHeaderProvided) {
		sheetArr = XLSX.utils.sheet_to_json(ws, { dateNF: 'YYYY-MM-DD HH:MM:SS' });
	} else {
		sheetArr = XLSX.utils.sheet_to_json(ws, {

		});
	}
	return sheetArr;
}

function getSheetDataFromGridFS(fileId){
	return new Promise((resolve, reject) => {
		global.gfsBucketImport.find({ filename : fileId }).toArray(function (err, file) {
			if (err) logger.error(err);
			if(file[0]){
				let readstream = global.gfsBucketImport.openDownloadStream(file[0]._id);
				readstream.on('error', function(err) { 
					logger.error(err);
					reject(err);
				});
				var bufs = [];
				readstream.on('data', function (d) { bufs.push(d); });
				readstream.on('end', function () {
					var buf = Buffer.concat(bufs);
					resolve(buf);
				});
			} else{
				reject(new Error('Issue in getting data from GridFS - SM'));
			}
		});
	});
}

e.validateData = (_req, _res) => {
	let data = _req.body;
	let isHeaderProvided = Boolean.valueOf(data.headers);
	let headerMapping = data.headerMapping;
	let fileName = data.fileName;
	let errorData = [];
	let conflictDataArrNew = [];
	let model = mongoose.model('complex');
	let fileId = _req.swagger.params.fileId.value;
	let serviceDetail = null;
	let validData = [];
	let validAfterConflict = [];
	let invalidSNo = JSON.parse(data.invalidSNo);
	let preHookSize = helperUtil.getPreHooks().length;
	let resultData = {};    
	getSheetDataFromGridFS(fileId)
		.then((bufferData)=> {
			let wb = XLSX.read(bufferData, { type: 'buffer', cellDates: true, cellNF: false, cellText: true, dateNF: 'YYYY-MM-DD HH:MM:SS' });
			let ws = wb.Sheets[wb.SheetNames[0]];
			let sheetData = getSheetData(ws, isHeaderProvided);
			let mappedSchemaData = substituteMappingSheetToSchema(sheetData, headerMapping);
			return mongoose.connection.db.collection('complex.fileTransfers').update({fileId: fileId }, {$set: {isHeaderProvided, headerMapping, status: 'Validating'}})
				.then(()=>{
					_res.status(202).json({message:'Validation Process Started...'});
					return mongoose.model('bulkCreate').remove({
						'fileId': fileId
					});
				})
				.then(() => {
					return helperUtil.getServiceDetail(serviceId, _req)
						.then(_sd => {
							serviceDetail = _sd;
							return enrichSchemaArray(mappedSchemaData);
						})
						.then(schemaJSON => {
							// validationData = schemaJSON;
							let sNo = isHeaderProvided ? 1 : 0;
							let serializedValidationData = schemaJSON.map(_obj=>{
								sNo++;
								let newObj = {};
								newObj.data = JSON.parse(JSON.stringify(_obj));
								newObj.sNo = sNo;
								return newObj;
							});
							let batch = 500;
							const apiCalls = preHookSize + serviceDetail.relatedSchemas.outgoing.length;
							if(apiCalls == 0) batch=2000;
							// if(apiCalls == 1) batch=1000;
							return processValidation(serializedValidationData, batch, model, serviceDetail, validData, errorData, invalidSNo, _req);
							// let validationPromiseArr = validationData.map(_obj => {
							//     sNo++;
							//     return fileMapperValidation(_obj, model, serviceDetail, sNo, validData, errorData, _req)
							// });
							// return Promise.all(validationPromiseArr);
						})
						.then(() => {
							logger.debug('Marking Errored Data');
							errorData = errorData.slice(0,102);
							if(errorData.length > 0){
								let errorArr = [];
								errorArr = errorData.map(_obj => {
									_obj._id = mongoose.Types.ObjectId();
									_obj['fileId'] = fileId;
									_obj['fileName'] = fileName;
									_obj['status'] = 'Error';
									return _obj;
								});
								return crudder.model.insertMany(errorArr);
							}
							if (errorData.length > 100){ 
								throw new Error('File contains more than 100 errors, cannot process');
							}
						})
						.then(() => {
							logger.debug('Marked Errored Data');
							return getConflictData(JSON.parse(JSON.stringify(validData)), isHeaderProvided, model, validAfterConflict);
						})
						.then(conflictDataArr=>{
							conflictDataArrNew = conflictDataArr;
							if(conflictDataArr.length>100){
								throw new Error('CONFLICT_MORE_THAN_100');
							}
							// conflictDataArrNew = conflictDataArr;
							let validArr = [];
							validArr = validAfterConflict.map(_obj => {
								_obj._id = mongoose.Types.ObjectId();
								_obj['fileId'] = fileId;
								_obj['fileName'] = fileName;
								_obj['status'] = 'Validated';
								return _obj;
							});
							logger.debug('Marking Validated Data');
							return crudder.model.insertMany(validArr);
						})
						.then(() => {
							logger.debug('Marked Validated Data');
							logger.debug('Marking Conflicted Data');
							if(conflictDataArrNew.length > 0){
								let conflictArr = [];
								conflictArr = conflictDataArrNew.map(_obj => {
									_obj._id = mongoose.Types.ObjectId();
									_obj['fileId'] = fileId;
									_obj['fileName'] = fileName;
									_obj['status'] = 'Duplicate';
									return _obj;
								});
								return crudder.model.insertMany(conflictArr);
							}
						})  
						.then(() => {
							logger.debug('Marked Conflicted Data');
							logger.debug('Fetching stats');
							return crudder.model.aggregate([{
								'$facet': {
									'duplicate': [{ '$match': { 'fileId': fileId, 'status': 'Duplicate', 'conflict': false } }, { '$count': 'duplicate' }],
									'conflicts': [{ '$match': { 'fileId': fileId, 'status': 'Duplicate', 'conflict': true} }, { '$count': 'conflicts' }],
									'valid': [{ '$match': { 'fileId': fileId, 'status': 'Validated' } }, { '$count': 'valid' }],
									'error': [{ '$match': { 'fileId': fileId, 'status': 'Error' } }, { '$count': 'error' }]
								}
							}]);
						})
						.then((finalData) => {
							logger.debug('Stats '+JSON.stringify(finalData));
							let result = {
								duplicate: (finalData[0].duplicate).length > 0 ? finalData[0].duplicate[0].duplicate : 0,
								conflicts: (finalData[0].conflicts).length > 0 ? finalData[0].conflicts[0].conflicts : 0,
								valid: (finalData[0].valid).length > 0 ? finalData[0].valid[0].valid : 0,
								errorCount: (finalData[0].error).length > 0 ? finalData[0].error[0].error : 0,
								status: 'Validated',
								'_metadata.lastUpdated':  new Date()
							};
							resultData = result;
							return mongoose.connection.db.collection('complex.fileTransfers').update({fileId: fileId }, {$set: result});
						})
						.then(()=>{
							let socketData = JSON.parse(JSON.stringify(resultData));
							socketData.fileId = fileId;
							socketData.userId = _req.headers[global.userHeader];
							socketData.fileName = fileName;
							logger.debug('socketData', socketData);
							return informGW(socketData);
						})
						.catch(err => {
							logger.error(err);
							let promise = Promise.resolve();
							if(err.message == 'ERROR_MORE_THAN_100'){
								err.message = 'File contains more than 100 error, cannot process';
								// errorData = errorData.slice(0,100);
								let errorArr = errorData.map(_obj => {
									_obj._id = mongoose.Types.ObjectId();
									_obj['fileId'] = fileId;
									_obj['fileName'] = fileName;
									_obj['status'] = 'Error';
									return _obj;
								});
								promise = crudder.model.insertMany(errorArr);
							}
							if(err.message == 'CONFLICT_MORE_THAN_100'){
								err.message = 'File contains more than 100 conflicts, cannot process';
								// conflictDataArrNew = conflictDataArrNew.slice(0,100);
								let conflictArr = conflictDataArrNew.map(_obj => {
									_obj._id = mongoose.Types.ObjectId();
									_obj['fileId'] = fileId;
									_obj['fileName'] = fileName;
									_obj['status'] = 'Duplicate';
									return _obj;
								});
								promise = crudder.model.insertMany(conflictArr);
							}
							if (!_res.headersSent) {
								_res.status(500).json({
									message: err.message
								});
							}
							// let socketData = {status:"Error", message:err.message, '_metadata.lastUpdated':  new Date()};
							// socketData.fileId = fileId;
							// socketData.userId = _req.headers[global.userHeader];
							// socketData.fileName = fileName;
							// logger.debug('socketData', socketData);
							return promise
								.then(()=>{
									logger.debug('Fetching stats');
									return crudder.model.aggregate([{
										'$facet': {
											'duplicate': [{ '$match': { 'fileId': fileId, 'status': 'Duplicate', 'conflict': false } }, { '$count': 'duplicate' }],
											'conflicts': [{ '$match': { 'fileId': fileId, 'status': 'Duplicate', 'conflict': true} }, { '$count': 'conflicts' }],
											'valid': [{ '$match': { 'fileId': fileId, 'status': 'Validated' } }, { '$count': 'valid' }],
											'error': [{ '$match': { 'fileId': fileId, 'status': 'Error' } }, { '$count': 'error' }]
										}
									}]);
								})
								.then((finalData)=>{
									let result = {
										duplicate: (finalData[0].duplicate).length > 0 ? finalData[0].duplicate[0].duplicate : 0,
										conflicts: (finalData[0].conflicts).length > 0 ? finalData[0].conflicts[0].conflicts : 0,
										valid: (finalData[0].valid).length > 0 ? finalData[0].valid[0].valid : 0,
										errorCount: (finalData[0].error).length > 0 ? finalData[0].error[0].error : 0,
										status: 'Error',
										'_metadata.lastUpdated': new Date()
									};
									resultData = result;
									return mongoose.connection.db.collection('complex.fileTransfers').update({ fileId: fileId }, { $set: result });
									// return mongoose.connection.db.collection('complex.fileTransfers').update({fileId: fileId }, {$set: {status:"Error", message:err.message, '_metadata.lastUpdated':  new Date()}})
								})
								.then(()=>{
									let socketData = JSON.parse(JSON.stringify(resultData));
									socketData.fileId = fileId;
									socketData.userId = _req.headers[global.userHeader];
									socketData.fileName = fileName;
									logger.debug('socketData', socketData);
									return informGW(socketData);
								});     
						});
				}).catch(err => new Error(err));
		});
};

function castType(rawDoc){
	let model = mongoose.model('complex');
	let doc = new model(rawDoc);
	return doc.toObject();
}

e.enrichDataForWF = function (_req, _res) {
	let page = _req.swagger.params.page.value;
	let count = _req.swagger.params.count.value;
	let fileId = _req.swagger.params.fileId.value;
	let filter = _req.swagger.params.filter.value;
	filter = filter ? JSON.parse(filter) : {fileId};
	let operation = _req.swagger.params.operation.value;
	page = (page === 1) ? page = 0 : page = page * count;
	return crudder.model.find(filter).skip(page).limit(count)
		.then(schemaArr => {
			let castData = schemaArr.map(_d => castType(_d.data));
			_req.query.source = 'filemapper enrich';
			return helperUtil.simulateDocs(castData, true, _req, operation);
		})
		.then(dataArr => {
			_res.status(200).json(dataArr);
		})
		.catch(err => {
			logger.error(err.message);
			_res.status(500).json(err.message);
		});    
};

e.enrichData = function (_req, _res) {
	let data = _req.body;
	let headerMapping = data.headerMapping;
	let sheetData = data.sheetData;
	let mappedSchemaData = substituteMappingSheetToSchema(sheetData, headerMapping);
	return enrichSchemaArray(mappedSchemaData)
		.then(schemaArr => {
			let castData = schemaArr.map(_d => castType(_d));
			_req.query.source = 'filemapper enrich';
			return helperUtil.simulateDocs(castData, true, _req, data.operation);
		})
		.then(dataArr => {
			_res.status(200).json(dataArr);
		})
		.catch(err => {
			logger.error(err.message);
			_res.status(500).json(err.message);
		});
};

function createDocs(schemaData, model, errors, _req, fileId){
	let createPromise = [];
	schemaData.forEach(doc => {
		createPromise.push(createDocPromise(_req, model, doc.data, doc.sNo, errors, fileId));
	});
	return Promise.all(createPromise);
}

function createInBatch(_req, model, schemaData, errors, fileId) {
	let output = [];
	var arrays = [],
		size = 500;
	while (schemaData.length > 0) {
		arrays.push(schemaData.splice(0, size));
	}
	return arrays.reduce((_p, _c, _i) => {
		return _p
			.then(() => {
				logger.debug('Running Batch ' + (_i+1));
				return createDocs(_c, model, errors, _req, fileId);
			})
			.then(_d => {
				output = output.concat(_d);
			});
	}, Promise.resolve())
		.then(() => {
			return output;
		});
}

function informGW(data){
	var options = {
		url: 'http://localhost:9080/gw/fileStatus/import',
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		json: true,
		body: data
	};
	logger.debug(JSON.stringify({options}));
	request.put(options, function (err, res, body) {
		if (err) {
			logger.error(err.message);
		}else{
			logger.debug(body);
		}
	});

}

e.bulkCreate = (_req, _res) => {
	let data = _req.body;
	let update = data.update ? data.update : [];
	let create = data.create ? data.create : [];
	let fileName = data.fileName;
	let fileId = _req.swagger.params.fileId.value;
	let model = mongoose.model('complex');
	let updatePromise = [];
	let errors = [];
	let finalResult = {};
	return mongoose.connection.db.collection('complex.fileTransfers').update({fileId: fileId }, {$set: {status: 'Importing'}})
		.then(()=>{
			_res.status(202).json({message: 'Creation Process started...'});
			return mongoose.model('bulkCreate').find({
				fileId,
				$or: [{ 'status': 'Validated' }, { 'sNo': { $in: create } }]
			});
		})
		.then((validStatus) => {
			return createInBatch(_req, model, validStatus, errors, fileId);
		})
		.then(() => {
			return crudder.model.find({
				fileId,
				'sNo': {
					'$in': update
				}
			});
		})
		.then(stagedDocs => {
			stagedDocs.forEach(_s => {
				let id = _s.data._id;
				if (id) {
					return model.findOne({ _id: id })
						.then(oldDoc => {
							updatePromise.push(updateDocPromise(_req, oldDoc, _s.data, errors, _s.sNo, fileId));
						});
				}
			});
			return Promise.all(updatePromise);
		})
		.then(() => {
			return crudder.model.aggregate([{
				'$facet': {
					'createdCount': [{ '$match': { 'fileId': fileId, 'status': 'Created' } }, { '$count': 'createdCount' }],
					'updatedCount': [{ '$match': { 'fileId': fileId, 'status': 'Updated' } }, { '$count': 'updatedCount' }],
					'errorCount': [{ '$match': { 'fileId': fileId, 'status': 'Error' } }, { '$count': 'errorCount' }]
				}
			}]);
		})
		.then((finalData) => {
			logger.error(JSON.stringify(errors));
			let result = {
				createdCount: (finalData[0].createdCount).length > 0 ? finalData[0].createdCount[0].createdCount : 0,
				updatedCount: (finalData[0].updatedCount).length > 0 ? finalData[0].updatedCount[0].updatedCount : 0,
				errorCount: (finalData[0].errorCount).length > 0 ? finalData[0].errorCount[0].errorCount : 0,
				status: 'Created',
				'_metadata.lastUpdated':  new Date()
			};
			finalResult = result;
			return mongoose.connection.db.collection('complex.fileTransfers').update({fileId: fileId }, {$set: result});
		})
		.then(()=>{
			let socketData = JSON.parse(JSON.stringify(finalResult));
			socketData.fileId = fileId;
			socketData.userId = _req.headers[global.userHeader];
			socketData.fileName = fileName;
			logger.debug(socketData);
			return informGW(socketData);
		})
		.catch(err => {
			logger.error(err.message);
			if (!_res.headerSent) {
				_res.status(500).json({
					message: err.message
				});
			}
			let socketData = {status:'Error', message:err.message, '_metadata.lastUpdated':  new Date()};
			socketData.fileId = fileId;
			socketData.userId = _req.headers[global.userHeader];
			socketData.fileName = fileName;
			logger.debug('socketData', socketData);
			return mongoose.connection.db.collection('complex.fileTransfers').update({fileId: fileId }, {$set: {status:'Error', message:err.message, '_metadata.lastUpdated':  new Date()}})
				.then(()=>{
					return informGW(socketData);
				});
		});
};

module.exports = e;