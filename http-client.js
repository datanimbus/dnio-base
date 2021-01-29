const request = require('request-promise');

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
    options["resolveWithFullResponse"] = true;

    return request(options)
}

module.exports.httpRequest = httpRequest;