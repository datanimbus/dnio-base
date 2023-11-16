/* eslint-disable no-async-promise-executor */
// const Excel = require('exceljs');
const log4js = require('log4js');
const fastcsv = require('fast-csv');

const logger = log4js.getLogger(global.loggerName);
/**
 * 
 * @param {string} fileId File ID generated by GW
 */
function readDataFromGridFS(fileId) {
	return new Promise((resolve, reject) => {
		const gfsBucketImport = global.gfsBucketImport;
		logger.debug(`[${fileId}] File mapper : readDataFromGridFS`);
		gfsBucketImport.find({ filename: fileId }).toArray(function (err, file) {
			if (err) {
				logger.error(err);
				return reject(err);
			}
			if (!file || !file[0]) {
				reject(new Error('Issue in getting data from GridFS'));
			}
			const readstream = gfsBucketImport.openDownloadStream(file[0]._id);
			readstream.on('error', function (err) {
				logger.error(err);
				reject(err);
			});
			const bufs = [];
			readstream.on('data', function (d) { bufs.push(d); });
			readstream.on('end', function () {
				const buf = Buffer.concat(bufs);
				resolve(buf);
			});
		});
	});
}

/**
 * 
 * @param {string} fileId File ID generated by GW
 */
function readStreamFromGridFS(fileId) {
	return new Promise((resolve, reject) => {
		const gfsBucketImport = global.gfsBucketImport;
		gfsBucketImport.find({ filename: fileId }).toArray(function (err, file) {
			if (err) {
				logger.error(err);
				return reject(err);
			}
			if (!file || !file[0]) {
				reject(new Error('Issue in getting data from GridFS'));
			}
			const readstream = gfsBucketImport.openDownloadStream(file[0]._id);
			resolve(readstream);
		});
	});
}

/**
 * 
 * @param {*} bufferData The GridFS data
 * @param {boolean} isHeaderProvided Flag for headers in file
 */
function getSheetData(bufferData, _isHeaderProvided) {
	return new Promise(async (resolve, reject) => {
		try {
			let sheetArr = [];
			fastcsv.parseString(bufferData.toString(), { headers: true })
				.on('data', data => sheetArr.push(data))
				.on('error', error => reject(error))
				.on('end', () => resolve(sheetArr));
		} catch (e) {
			reject(e);
		}
	});
}


// function sheettojson(ws, isHeaderProvided) {
// 	const json = [];

// 	if (isHeaderProvided) {
// 		const headerRow = ws.getRow(1);
// 		ws.eachRow({ includeEmpty: true }, function (row, rowNumber) {
// 			if (rowNumber === 1) {
// 				return;
// 			}
// 			const rowJson = {};

// 			row.eachCell(function (cell, colNumber) {
// 				rowJson[headerRow.getCell(colNumber).value] = cell.value;
// 			});

// 			json.push(rowJson);
// 		});
// 	} else {
// 		ws.eachRow({ includeEmpty: true }, function (row, _rowNumber) {
// 			const rowJson = {};

// 			row.eachCell(function (cell, _colNumber) {
// 				rowJson[cell.address] = cell.value;
// 			});

// 			json.push(rowJson);
// 		});
// 	}
// 	return json;
// }


/**
 * 
 * @param {object} sheetJson The JSON data from Sheet
 * @param {object} mapping The Mapping object recieved
 */
function objectMapping(sheetJson, mapping) {
	const newDoc = {};
	if (!mapping) return;
	if (mapping && mapping.constructor == {}.constructor) {
		Object.keys(mapping).forEach(key => {
			if (typeof mapping[key] == 'string') {
				if (key === '_id') {
					if (sheetJson[mapping[key]] !== null && sheetJson[mapping[key]] !== undefined) {
						newDoc[key] = sheetJson[mapping[key]] + '';
					}
				} else {
					newDoc[key] = sheetJson[mapping[key]];
				}
			} else if (Array.isArray(mapping[key])) {
				newDoc[key] = mapping[key].map(_o => {
					return objectMapping(sheetJson, _o);
				});
				newDoc[key] = newDoc[key].filter(_d => _d);
				if (newDoc[key].length == 0) delete newDoc[key];
			} else {
				newDoc[key] = objectMapping(sheetJson, mapping[key]);
			}
		});
	} else if (typeof mapping == 'string') {
		return sheetJson[mapping];
	}
	if (newDoc && Object.keys(JSON.parse(JSON.stringify(newDoc))).length > 0) {
		return newDoc;
	}
	return;
}


module.exports.readDataFromGridFS = readDataFromGridFS;
module.exports.readStreamFromGridFS = readStreamFromGridFS;
module.exports.getSheetData = getSheetData;
module.exports.objectMapping = objectMapping;