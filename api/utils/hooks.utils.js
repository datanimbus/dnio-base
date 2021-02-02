const fs = require('fs');
const path = require('path');
const _ = require('lodash');

const config = require('../../config');
const queueMgmt = require('../../queue');
const httpClient = require('../../http-client');

const mongoose = require('mongoose');

const logger = global.logger;
const client = queueMgmt.client;


/**
 * 
 * @param {*} req 
 * @param {*} data 
 * @param {Object} options 
 * @param {string} options.operation 
 * @param {string} options.source 
 * @param {boolean} options.simulate 
 * @param {boolean} options.log 
 * @returns {Promise<object>}
 */
function callAllPreHooks(req, data, options) {
	let txnId = req.get("TxnId")
	logger.debug(`[${txnId}] PreHook :: Options :: ${JSON.stringify(options)}`)
	logger.trace(`[${txnId}] PreHook :: ${JSON.stringify(data)}`)
  let self = JSON.parse(JSON.stringify(data));
  let preHooks = [];
  try {
    preHooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8')).preHooks;
  } catch (e) {
		logger.debug(`[${txnId}] PreHook :: Parser error :: ${e.message}`)
  }
	logger.info(`[${txnId}] PreHook :: ${preHooks.length} found`)
  preHooks.forEach(_d => logger.info(`[${txnId}] PreHook :: ${_d.name} - ${_d.url} `))
  return preHooks.reduce(function (acc, curr) {
    let oldData = null;
    let preHookLog = null;
    return acc.then(_data => {
      oldData = _data;
      preHookLog = constructPreHookLog(req, curr, options);
      preHookLog.data.old = oldData;
      const payload = constructPayload(req, _data, options);
      return invokeHook(curr.url, payload, curr.failMessage);
    }).then(_data => {
      const newData = Object.assign({}, oldData, _data.data);
      newData._metadata = oldData._metadata;
      preHookLog.status = 'Completed';
      preHookLog.data.new = newData;
    }).catch(err => {
      preHookLog.status = 'Error';
      preHookLog.comment = err.message;
      preHookLog.message = err.message;
      throw err;
    }).finally(() => {
      if (options && options.log) client.publish('prehookCreate', JSON.stringify(preHookLog));
    });
  }, Promise.resolve(self));
}

/**
 * 
 * @param {*} req 
 * @param {*} data 
 * @param {Object} options 
 * @param {string} options.operation 
 * @param {string} options.source 
 * @param {boolean} options.simulate 
 * @param {boolean} options.log 
 */
function constructPayload(req, data, options) {
    const payload = {};
    payload.trigger = {};
    payload.operation = options.operation;
    payload.txnId = req.headers[global.txnIdHeader];
    payload.user = req.headers[global.userHeader];
    payload.data = JSON.parse(JSON.stringify(data));
    payload.trigger.source = options.source;
    payload.trigger.simulate = options.simulate;
    payload.dataService = config.serviceId;
    return payload;
}

/**
 * 
 * @param {*} req 
 * @param {*} data 
 * @param {Object} options 
 * @param {string} options.operation 
 * @param {string} options.source 
 * @param {boolean} options.simulate 
 * @param {boolean} options.log 
 */
function constructPreHookLog(req, preHook, options) {
    const logData = {};
    logData._metadata = {};
    logData._metadata.createdAt = new Date();
    logData._metadata.lastUpdated = new Date();
    logData.data = {};
    logData.service = config.serviceId
    logData.timestamp = new Date();
    logData.url = preHook.url;
    logData.name = preHook.name
    logData.operation = options.operation;
    logData.trigger = {};
    logData.trigger.source = options.source;
    logData.trigger.simulate = options.simulate;
    logData.txnId = req.headers[global.txnIdHeader];
    logData.userId = req.headers[global.userHeader];
    return logData;
}

/**
 * 
 * @param {string} url The URL that needs to be invoked
 * @param {*} data The Payload that needs to be sent
 * @param {string} [customErrMsg] The Custom Error Message
 */
function invokeHook(url, data, customErrMsg) {
    let timeout = (process.env.HOOK_CONNECTION_TIMEOUT && parseInt(process.env.HOOK_CONNECTION_TIMEOUT)) || 30;
    var options = {
        url: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        json: true,
        body: data,
        timeout: timeout * 1000
    };
    if (typeof process.env.TLS_REJECT_UNAUTHORIZED === 'string' && process.env.TLS_REJECT_UNAUTHORIZED.toLowerCase() === 'false') {
        options.insecure = true;
        options.rejectUnauthorized = false;
    }
    return new Promise((resolve, reject) => {
        httpClient.httpRequest(options).then(res => {
            if (!res) {
                const message = customErrMsg ? customErrMsg : 'Pre-save link ' + url + ' down. Unable to proceed. ';
                logger.error('Error requesting hook'.url);
                reject(new Error(message));
            } else {
                if (res.statusCode >= 200 && res.statusCode < 400) {
                    resolve(res.body);
                } else {
                    let errMsg;
                    if (res.body && res.body.message) {
                        errMsg = res.body.message;
                    } else {
                        errMsg = 'Error invoking pre-save link ' + url + '  .Unable to proceed. ';
                    }
                    reject(new Error(errMsg));
                }
            }
        }).catch(err => {
            logger.error('Error requesting hook', url)
            logger.error(err.message);
            const message = customErrMsg ? customErrMsg : 'Pre-save link ' + url + ' down. Unable to proceed. ';
            reject(new Error(message));
        });
    });
}


/**
* 
* @param {*} req Incoming request Object
* @param {*} res Server response Object
*/
function callExperienceHook(req, res) {
    const hookName = unescape(req.params.name);
    let payload = req.body;
    let hooks;
    try {
        hooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8')).experienceHooks;
    } catch (e) {
        logger.error('Parsing Exp-Hook', e);
        return res.status(500).json({ message: 'Parsing Exp-Hook' + e.message });
    }
    try {
        const wantedHook = hooks.find(e => hookName == e.name);
        if (!wantedHook) {
            return res.status(400).json({ message: 'Invalid Hook' });
        }
        if (!payload.data) {
            return res.status(400).json({ message: 'Invalid Request' });
        }
        const options = {
            url: wantedHook.url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'TxnId': req.headers[global.txnIdHeader],
                'Authorization': req.headers.authorization,
                'User': req.headers[global.userHeader]
            },
            body: {
                data: payload.data,
                txnId: req.headers[global.txnIdHeader],
                user: req.headers[global.userHeader],
                dataService: config.serviceId
            },
            json: true
        };
        httpClient.httpRequest(options).then(httpRes => {
            if (!httpRes) {
                logger.error('Experience Hook down');
                return res.status(404).json({ message: 'Unable to connect to Hook Url' });
            }
            let errMessage = hookUrl.errorMessage;
            if (resp.statusCode >= 400) {
                if (body.message) errMessage = body.message;
                return res.status(resp.statusCode).json({ message: errMessage });
            }
            return res.status(resp.statusCode).json(body);
        }, err => {
            logger.error('Error requesting Experience Hook', err);
            return res.status(500).json({ message: 'Error while requesting hook' });
        });
    } catch (e) {
        let message;
        if (typeof e === 'string') {
            message = e;
        } else {
            message = e.message;
        }
        logger.error(e);
        return res.status(500).json({ message });
    }
}



async function getHooks() {
		logger.trace(`Get hooks`);
    try {
			let authorDB = mongoose.connections[1].client.db(config.authorDB)
			authorDB.collection('services').findOne({_id: config.serviceId}, {projection: {preHooks:1, wizard:1}})
			.then(_d => {
				if(!_d) {
          logger.error(`Get hooks :: Unable to find ${config.serviceId}`);
          return;
				}
	      logger.trace(`Get hooks :: data :: ${JSON.stringify(_d)}`)
      	setHooks(_d);
			})
    } catch (err) {
      logger.error(`Get hooks :: ${err.message}`);
    }
}

function setHooks(data) {
    let json = JSON.parse(JSON.stringify(data));
    if (data && typeof data === 'object') {
        json.experienceHooks = createExperienceHooksList(data);
        delete json._id;
        const filePath = path.join(process.cwd(), 'hooks.json');
        if (fs.existsSync(filePath)) {
            const temp = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            json = _.assign(temp, json);
        }
        fs.writeFileSync(filePath, JSON.stringify(json), 'utf-8');
    }
}

function createExperienceHooksList(data) {
    let hooks = [];
    let wizard = data.wizard;
    if (wizard) {
        hooks = [].concat.apply([], wizard.map(_d => _d.actions));
        logger.trace(`Experience hooks - ${JSON.stringify(hooks)}`);
    }
    return hooks;
}


module.exports.callAllPreHooks = callAllPreHooks;
module.exports.callExperienceHook = callExperienceHook;
module.exports.getHooks = getHooks;
module.exports.invokeHook = invokeHook;
