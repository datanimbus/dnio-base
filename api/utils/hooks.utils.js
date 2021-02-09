const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const crypto = require("crypto");

const config = require('../../config');
const queueMgmt = require('../../queue');
const httpClient = require('../../http-client');
const commonUtils = require('./common.utils');

const mongoose = require('mongoose');

const logger = global.logger;
const client = queueMgmt.client;

client.on('connect', () => {
	getHooks()
	processHooksQueue()
})

client.on('reconnect', () => {
	getHooks()
	processHooksQueue()
})

async function saveHook(_txnId, type, operation, _oldData, _newData){
	let model = mongoose.model('webHooks')
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
 * @returns {Promise<object>}
 */
function callAllPreHooks(req, data, options) {
	let txnId = req.headers[global.txnIdHeader]
	options["type"] = "PreHook"
	logger.debug(`[${txnId}] PreHook :: Options :: ${JSON.stringify(options)}`)
	logger.trace(`[${txnId}] PreHook :: ${JSON.stringify(data)}`)
  let preHooks = [];
  try {
    preHooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8')).preHooks;
  } catch (e) {
		logger.error(`[${txnId}] PreHook :: Parser error :: ${e.message}`)
  }
	logger.info(`[${txnId}] PreHook :: ${preHooks.length} found`)
  preHooks.forEach(_d => logger.info(`[${txnId}] PreHook :: ${_d.name} - ${_d.url} `))
  let properties = commonUtils.generateProperties(txnId)
  let headers = commonUtils.generateHeaders(txnId)
  let newData = {}
  return preHooks.reduce(function (acc, curr) {
    let oldData = null;
    let preHookLog = null;
    let payload = {}
    return acc.then(_data => {
      oldData = _data;
      preHookLog = constructHookLog(req, curr, options);
      preHookLog.txnId = txnId
      preHookLog.headers = headers
      preHookLog.properties = properties
      preHookLog.data.old = oldData;
      payload = constructPayload(req, curr, _data, options);
      payload["properties"] = properties
      return invokeHook(txnId, curr.url, payload, curr.failMessage, headers);
    }).then(_data => {
      newData = Object.assign({}, oldData, _data.data);
      newData._metadata = oldData._metadata;
      preHookLog.status = 'Completed';
      preHookLog.data.new = newData;
      return newData
    }).catch(err => {
      logger.error(`[${txnId}] PreHook :: ${err.message}`)
      preHookLog.status = 'Error';
      preHookLog.message = err.message;
      throw preHookLog
    }).finally(() => {
      if (!config.disableInsights) insertHookLog("PreHook", txnId, preHookLog)
    });
  }, Promise.resolve(JSON.parse(JSON.stringify(data))))
}

function prepPostHooks(_data){
	let txnId = _data.txnId
	logger.trace(`[${txnId}] PostHook :: ${JSON.stringify(_data)}`)
  let postHooks = [];
  try {
    postHooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8')).webHooks;
  } catch (e) {
		logger.error(`[${txnId}] PostHook :: Parser error :: ${e.message}`)
		throw e
  }
  let operation = 'POST'
  if(_data.old && _data.new) operation = 'PUT'
  if(_data.old && !_data.new) operation = 'DELETE'
	logger.info(`[${txnId}] PostHook :: ${postHooks.length} found`)
  postHooks.forEach(_d => logger.info(`[${txnId}] PostHook :: ${_d.name} - ${_d.url} `))
	let postHookLog = {
		txnId: txnId,
		user: _data.user,
		status: 'Pending',
		message: null,
		retry: 0,
		operation: operation,
		type: 'PostHook',
		trigger: {
			source: 'postSave',
			simulate: false,
		},
		service: {
			id: config.serviceId,
			name: config.serviceName
		},
  	callbackUrl: `/api/c/${config.app}${config.serviceEndpoint}/utils/callback`,
		headers: commonUtils.generateHeaders(txnId),
		properties: commonUtils.generateProperties(txnId),
		data: {
			old: _data.old,
			new: _data.new
		},
		logs: [],
		scheduleTime: null,
		_metadata: {
    	createdAt: new Date(),
    	lastUpdated: new Date(),
    	version: {
    		release: process.env.RELEASE || 'dev'
    	},
    	disableInsights: config.disableInsights
  	}
  }
  let streamingPayload = {
  	collection: `${config.app}.hook`,
  	txnId: txnId, 
  	retry: 0
  }
  return postHooks.reduce(function (_prev, _curr) {
    return _prev.then(_data => {
    	postHookLog["_id"] = crypto.randomBytes(16).toString("hex")
    	postHookLog.callbackUrl = `${postHookLog.callbackUrl}/${postHookLog._id}`
    	streamingPayload["_id"] = postHookLog["_id"]
    	postHookLog["name"]= _curr.name
			postHookLog["url"]= _curr.url
      insertHookLog('PostHook', txnId, postHookLog)
      queueMgmt.sendToQueue(streamingPayload);
    });
  }, Promise.resolve())
}

function insertHookLog(_type, _txnId, _data){
	logger.trace(`[${_txnId}] ${_type} log :: ${JSON.stringify(_data)}`)
	global.logsDB.collection(`${config.app}.hook`).insertOne(_data)
	.then(_d => logger.debug(`[${_txnId}] ${_type} log :: ${_data._id}`))
	.catch(_e => logger.error(`[${_txnId}] ${_type} log :: ${_data._id} :: ${_e.message}`))
}

function insertAuditLog(_txnId, _data){
	logger.trace(`[${_txnId}] ${_type} Audit log :: ${JSON.stringify(_data)}`)
	global.logsDB.collection(`${_data.colName}`).insertOne(_data)
	.then(_d => logger.debug(`[${_txnId}] ${_type} Audit log :: ${_data._id}`))
	.catch(_e => logger.error(`[${_txnId}] ${_type} Audit log :: ${_data._id} :: ${_e.message}`))
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
function constructPayload(req, preHook, data, options) {
    const payload = {};
    payload.trigger = {};
    payload.operation = options.operation;
    payload.txnId = req.headers[global.txnIdHeader];
    payload.user = req.get("User");
    payload.data = JSON.parse(JSON.stringify(data));
    payload.trigger.source = options.source;
    payload.trigger.simulate = options.simulate;
    payload.dataService = config.serviceId;
    payload.name = preHook.name;
    payload.app = config.appNamespace;
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
function constructHookLog(req, hook, options) {
  return {
  	_id: crypto.randomBytes(16).toString("hex"),
  	name: hook.name,
		url: hook.url,
		user: req.headers[global.userHeader],
		txnId: req.headers[global.txnIdHeader],
		status: 'Initiated',
		errorMessage: '',
		retry: 0,
		operation: options.operation,
		type: options.type,
		trigger: {
			source: options.source,
			simulate: options.simulate,
		},
		service: {
			id: config.serviceId,
			name: config.serviceName
		},
		headers: {},
		properties: {},
		data: {
			old: null,
			new: null
		},
		_metadata: {
    	createdAt: new Date(),
    	lastUpdated: new Date()
  	}
  }
}

/**
 * 
 * @param {string} url The URL that needs to be invoked
 * @param {*} data The Payload that needs to be sent
 * @param {string} [customErrMsg] The Custom Error Message
 */
function invokeHook(txnId, url, data, customErrMsg, _headers) {
  let timeout = (process.env.HOOK_CONNECTION_TIMEOUT && parseInt(process.env.HOOK_CONNECTION_TIMEOUT)) || 30;
  data.properties = data.properties || commonUtils.generateProperties(txnId)
  let headers = _headers || commonUtils.generateHeaders(txnId)
  headers['Content-Type'] = 'application/json'
  headers['TxnId'] = txnId
  var options = {
    url: url,
    method: 'POST',
    headers: headers,
    json: true,
    body: data,
    timeout: timeout * 1000
  };
  if (typeof process.env.TLS_REJECT_UNAUTHORIZED === 'string' && process.env.TLS_REJECT_UNAUTHORIZED.toLowerCase() === 'false') {
    options.insecure = true;
    options.rejectUnauthorized = false;
  }
  return httpClient.httpRequest(options)
  .then(res => {
    if (!res) {
      logger.error(`Error requesting hook :: ${url}`);
      let message = customErrMsg ? customErrMsg : `Pre-save link ${url} down!Unable to proceed.`;
      throw new Error(message)
    } else {
      if (res.statusCode >= 200 && res.statusCode < 400) return res.body
      else {
        let errMsg = `Error invoking pre-save link ${url}.Unable to proceed.`;
        if (res.body && res.body.message) errMsg = res.body.message
        throw new Error(errMsg)
      }
    }
  })
  .catch(err => {
    logger.error(`Error requesting hook :: ${url} :: ${err.message}`);
    const message = customErrMsg ? customErrMsg : `Pre-save "${data.name}" down! Unable to proceed.`;
    throw new Error(message)
  });
}

/**
* 
* @param {*} req Incoming request Object
* @param {*} res Server response Object
*/
function callExperienceHook(req, res) {
	const txnId = req.headers[global.txnIdHeader]
  
  const hookName = req.query.name;
  const payload = req.body || {};
  
  let hooks;
  try {
    hooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8')).experienceHooks;
  	logger.trace(`[${txnId}] Experience hook :: Hooks :: ${JSON.stringify(hooks)}`)
  } catch (e) {
    logger.erorr(`[${txnId}] Experience hook :: Parse error :: ${e.message}`)
    return res.status(500).json({ message: `Parsing error ${e.message}`})
  }
  try {
    const wantedHook = hooks.find(hook => hookName == hook.name);
    if (!wantedHook) {
    	logger.error(`[${txnId}] Experience hook :: ${hookName} :: Not found`)
      return res.status(400).json({ message: `Invalid experience hook ${hookName}` });
    }
    logger.debug(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url}`)
    
    let headers = commonUtils.generateHeaders(txnId)
    headers['Content-Type'] = 'application/json'
    headers['TxnId'] = txnId
    headers['User'] = req.headers[global.userHeader]

    const data = {
      data: payload.data,
      txnId: req.headers[global.txnIdHeader],
      user: req.get("User"),
      type: 'ExperienceHook',
      service: {
				id: config.serviceId,
				name: config.serviceName
			},
      properties: commonUtils.generateProperties(txnId),
      name: wantedHook.name,
      url: wantedHook.url,
      label: wantedHook.label
    }

    const options = {
      url: wantedHook.url,
      method: 'POST',
      headers: headers,
      body: data,
      json: true
    };
    httpClient.httpRequest(options)
    .then(hookResponse => {
	    if (!hookResponse) {
	      let message = wantedHook.errorMessage || `Experience hook link ${url} down! Unable to proceed.`;
	      logger.error(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: Link has no power`)
	      data["status"] = "Fail"
	      data["message"] = message
	      return res.status(500).json({ message })
	    } else if (hookResponse.statusCode >= 200 && hookResponse.statusCode < 400) {
      	logger.debug(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: Response :: ${hookResponse.statusCode}`)
      	logger.trace(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: Body :: ${JSON.stringify(hookResponse.body)}`)
	      data["status"] = "Success"
	      data["message"] = hookResponse.statusCode
      	return res.json(hookResponse.body)
      }
	  })
	  .catch(err => {
      let message = `Error invoking experience hook. Unable to proceed.`;
      if (err.response.body && err.response.body.message) message = err.response.body.message
      message = wantedHook.errorMessage || message
    	logger.trace(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: Response :: ${err.statusCode}`)
    	logger.error(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: Body :: ${JSON.stringify(err.response.body)}`)
	    data["status"] = "Fail"
	    data["message"] = message
      return res.status(500).json({ message })
	  })
	  .finally(() => {
	  	data["_id"] = crypto.randomBytes(16).toString("hex")
	  	data["url"] = wantedHook.url
	  	data["_metadata"] = {
	    	createdAt: new Date(),
	    	lastUpdated: new Date(),
	    	version: {
	    		release: process.env.RELEASE || 'dev'
	    	}
    	}
    	if(!config.disableInsights) insertHookLog('ExperienceHook', txnId, data)
	  })
  } catch (e) {
    let message;
    if (typeof e === 'string') message = e
    else message = e.message
	  logger.error(`[${txnId}] Experience hook :: ${hookName} :: ${message}`)
    return res.status(500).json({ message })
  }
}

function processHooksQueue() {
	// check if this is running inside a worker
	if (global.doNotSubscribe) return
	logger.info(`Starting subscription to hooks channel`)
  try {
      var opts = client.subscriptionOptions();
      opts.setStartWithLastReceived();
      opts.setDurableName(config.serviceId + '-hooks-durable');
      var subscription = client.subscribe(config.serviceId + '-hooks', config.serviceId + '-hooks', opts);
      subscription.on('message', function (_body) {
          try {
              let bodyObj = JSON.parse(_body.getData());
              logger.debug(`Message from hooks channel :: ${config.serviceId}-hooks :: ${JSON.stringify(bodyObj)}`);
              setHooks(bodyObj);
          } catch (err) {
              logger.error(`Error processing hooks message :: ${err.message}`);
          }
      });
  } catch (err) {
      logger.error(`Hooks channel :: ${err.message}`);
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

async function getHooks() {
		logger.trace(`Get hooks`);
    try {
			let authorDB = mongoose.connections[1].client.db(config.authorDB)
			authorDB.collection('services').findOne({_id: config.serviceId}, {projection: {preHooks:1, wizard:1, webHooks:1}})
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

function createExperienceHooksList(data) {
    let hooks = [];
    let wizard = data.wizard;
    if (wizard) {
        hooks = [].concat.apply([], wizard.map(_d => _d.actions));
        logger.trace(`Experience hooks - ${JSON.stringify(hooks)}`);
    }
    return hooks;
}

module.exports = {
	callAllPreHooks,
	prepPostHooks,
	callExperienceHook,
	getHooks,
	setHooks,
	insertHookLog,
	insertAuditLog,
	saveHook
}
