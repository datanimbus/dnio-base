const request = require('request');

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

    return new Promise((resolve, reject) => {
        request(options, function (err, res, body) {
            if (err) {
                reject(err);
            } else {
                resolve(res);
            }
        });
    })
}

module.exports.httpRequest = httpRequest;