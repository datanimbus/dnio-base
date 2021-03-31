const XLSX = require('xlsx');

const logger = global.logger;
/**
 * 
 * @param {string} fileId File ID generated by GW
 */
function readDataFromGridFS(fileId) {
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
 * @param {*} bufferData The GridFS data
 * @param {boolean} isHeaderProvided Flag for headers in file
 */
function getSheetData(bufferData, isHeaderProvided) {
	return new Promise((resolve, reject) => {
		try {
			const wb = XLSX.read(bufferData, { type: 'buffer', cellDates: true, cellNF: false, cellText: true, dateNF: 'YYYY-MM-DD HH:MM:SS' });
			const ws = wb.Sheets[wb.SheetNames[0]];
			if (!ws['!ref']) return resolve([]);
			let sheetArr = [];
			if (isHeaderProvided) {
				sheetArr = XLSX.utils.sheet_to_json(ws, { dateNF: 'YYYY-MM-DD HH:MM:SS' });
			} else {
				sheetArr = XLSX.utils.sheet_to_json(ws, {});
			}
			return resolve(sheetArr);
		} catch (e) {
			reject(e);
		}
	});
}

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
				newDoc[key] = sheetJson[mapping[key]];
			} else if (Array.isArray(mapping[key])) {
				newDoc[key] = mapping[key].map(_o => {
					return objectMapping(sheetJson, _o);
				});
				newDoc[key] = newDoc[key].filter(_d => _d);
				if(newDoc[key].length == 0) delete newDoc[key];
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
module.exports.getSheetData = getSheetData;
module.exports.objectMapping = objectMapping;