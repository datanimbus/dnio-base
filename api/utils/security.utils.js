
const crypto = require('crypto');

const config = require('../../config');
const httpClient = require('../../http-client');

const logger = global.logger;

function encryptText(data) {
	const options = {
		url: config.baseUrlSEC + `/enc/${config.app}/decrypt`,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: { data },
		json: true
	};
	return httpClient.httpRequest(options).then(res => {
		if (!res) {
			logger.error('Security service down');
			throw new Error('Security service down');
		}
		if (res.statusCode === 200) {
			let encryptValue = res.body.data;
			let obj = {
				value: encryptValue,
				checksum: crypto.createHash('md5').update(data).digest('hex')
			};
			return obj;
		} else {
			throw new Error('Error decrypting text');
		}
	}).catch(err => {
		logger.error('Error requesting Security service');
		throw err;
	});
}


function decryptText(data) {
	const options = {
		url: config.baseUrlSEC + `/enc/${config.app}/decrypt`,
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: { data },
		json: true
	};
	return httpClient.httpRequest(options).then(res => {
		if (!res) {
			logger.error('Security service down');
			throw new Error('Security service down');
		}
		if (res.statusCode === 200) {
			return res.body.data;
		} else {
			throw new Error('Error encrypting text');
		}
	}).catch(err => {
		logger.error('Error requesting Security service');
		throw err;
	});
}

function md5(text) {
	return crypto.createHash('md5').update(text).digest('hex');
}

module.exports.encryptText = encryptText;
module.exports.decryptText = decryptText;
module.exports.md5 = md5;