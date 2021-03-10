const request = require('request-promise');
const sh = require('shorthash');
const crypto = require('crypto');
/**
 * @typedef {Object} QueryParams
 * @property {string} [select]
 * @property {string} [sort]
 * @property {number} [page]
 * @property {number} [count]
 * @property {string} filter
 */

/**
 * @typedef {Object} Options
 * @property {string} url
 * @property {string} [method=get]
 * @property {*} body
 * @property {*} formdata
 * @property {*} headers
 * @property {number} timeout
 * @property {boolean} insecure
 * @property {boolean} rejectUnauthorized
 * @property {QueryParams} qs
 */

/**
 * 
 * @param {Options} options 
 */
function httpRequest(options) {
	if (!options) {
		options = {};
	}
	if (!options.method) {
		options.method = 'GET';
	}
	options.json = true;
	options['resolveWithFullResponse'] = true;
	if (!options['headers']) {
		options['headers'] = {};
	}
	if (!options['headers']['TxnId']) {
		options['headers']['TxnId'] = `${process.env.SERVICE_ID || 'BASE'}_${sh.unique(crypto.createHash('md5').update(Date.now().toString()).digest('hex'))}`;
		options['headers']['USER'] = `${process.env.SERVICE_ID || 'BASE'}`;
	}

	return request(options);
}

module.exports.httpRequest = httpRequest;