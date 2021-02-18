const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const crypto = require('crypto');

const config = require('../../config');
const queueMgmt = require('../../queue');
const httpClient = require('../../http-client');
const commonUtils = require('./common.utils');

const mongoose = require('mongoose');

const logger = global.logger;
const client = queueMgmt.client;

client.on('connect', () => {
	getHooks();
	processHooksQueue();
});

client.on('reconnect', () => {
	getHooks();
	processHooksQueue();
});

// Function not used. commented
// async function saveHook(_txnId, type, operation, _oldData, _newData){
// 	let model = mongoose.model('webHooks');
// }

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
	let txnId = req.headers[global.txnIdHeader];
	options['type'] = 'PreHook';
	logger.debug(`[${txnId}] PreHook :: Options :: ${JSON.stringify(options)}`);
	logger.trace(`[${txnId}] PreHook :: ${JSON.stringify(data)}`);
	let preHooks = [];
	try {
		preHooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8')).preHooks;
	} catch (e) {
		logger.error(`[${txnId}] PreHook :: Parser error :: ${e.message}`);
	}
	logger.info(`[${txnId}] PreHook :: ${preHooks.length} found`);
	preHooks.forEach(_d => logger.info(`[${txnId}] PreHook :: ${_d.name} - ${_d.url} `));
	let properties = commonUtils.generateProperties(txnId);
	let headers = commonUtils.generateHeaders(txnId);
	let newData = {};
	let docId = data._id || null;
	return preHooks.reduce(function (acc, curr) {
		let oldData = null;
		let preHookLog = {};
		let payload = {};
		return acc.then(_data => {
			oldData = _data;
			preHookLog = constructHookLog(req, curr, options);
			preHookLog.txnId = txnId;
			preHookLog.headers = headers;
			preHookLog.properties = properties;
			preHookLog.data.old = oldData;
			preHookLog.docId = docId;
			payload = constructPayload(req, curr, _data, options);
			payload.docId = docId;
			payload['properties'] = properties;
			return invokeHook(txnId, curr.url, payload, curr.failMessage, headers);
		}).then(_response => {
			newData = Object.assign({}, oldData, _response.body.data);
			newData._metadata = oldData._metadata;
			preHookLog.data.new = newData;
			preHookLog.status = 'Success';
			preHookLog.statusCode = _response.statusCode;
			preHookLog.response.headers = _response.headers;
			preHookLog.response.body = _response.body;
			return newData;
		}).catch(err => {
			logger.error(`[${txnId}] PreHook :: ${curr.name} :: ${err.message}`);
			preHookLog.message = err.message;
			preHookLog.status = 'Error';
			if (err.response) {
				preHookLog.status = 'Fail';
				preHookLog.statusCode = err.response.statusCode;
				preHookLog.response = {};
				preHookLog.response.headers = err.response.headers;
				preHookLog.response.body = err.response.body;
			}
			throw preHookLog;
		}).finally(() => {
			if (!config.disableInsights && preHookLog && preHookLog._id) insertHookLog('PreHook', txnId, preHookLog);
		});
	}, Promise.resolve(JSON.parse(JSON.stringify(data))));
}

function prepPostHooks(_data) {
	let txnId = _data.txnId;
	logger.trace(`[${txnId}] PostHook :: ${JSON.stringify(_data)}`);
	let postHooks = [];
	try {
		postHooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8')).webHooks;
	} catch (e) {
		logger.error(`[${txnId}] PostHook :: Parser error :: ${e.message}`);
		throw e;
	}
	let operation = 'POST';
	let docId = _data.new._id;
	if (_data.old && _data.new) operation = 'PUT';
	if (_data.old && !_data.new) {
		operation = 'DELETE';
		docId = _data.old._id;
	}
	logger.info(`[${txnId}] PostHook :: ${docId} :: ${postHooks.length} found`);
	postHooks.forEach(_d => logger.info(`[${txnId}] PostHook :: ${docId} :: ${_d.name} - ${_d.url} `));
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
		docId: docId,
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
	};
	let streamingPayload = {
		collection: `${config.app}.hook`,
		txnId: txnId,
		retry: 0
	};
	return postHooks.reduce(function (_prev, _curr) {
		return _prev.then(() => {
			postHookLog['_id'] = crypto.randomBytes(16).toString('hex');
			postHookLog.callbackUrl = `${postHookLog.callbackUrl}/${postHookLog._id}`;
			streamingPayload['_id'] = postHookLog['_id'];
			postHookLog['name'] = _curr.name;
			postHookLog['url'] = _curr.url;
			insertHookLog('PostHook', txnId, postHookLog);
			queueMgmt.sendToQueue(streamingPayload);
		});
	}, Promise.resolve());
}

function prepWorkflowHooks(_data) {
	const txnId = _data.txnId;
	const operation = _data.operation;
	const workFlowId = _data._id;
	const docId = _data.documentId;
	const type = _data.type;
	logger.info(`[${txnId}] WorkflowHooks :: ${workFlowId} :: Status :: ${type.toUpperCase()}`);
	let workflowHooks = [];
	try {
		const hooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8'));
		workflowHooks = hooks.workflowHooks && hooks.workflowHooks.postHooks ? hooks.workflowHooks.postHooks[_data.type] : [];
	} catch (e) {
		logger.error(`[${txnId}] WorkflowHooks :: ${workFlowId} :: Parser error :: ${e.message}`);
		throw e;
	}
	logger.info(`[${txnId}] WorkflowHooks :: ${workFlowId} :: ${workflowHooks.length} found`);
	workflowHooks.forEach(_d => logger.info(`[${txnId}] WorkflowHooks :: ${workFlowId} :: ${_d.name} - ${_d.url} `));
	let workflowHookLog = {
		txnId: txnId,
		user: _data.requestedBy,
		status: 'Pending',
		message: null,
		retry: 0,
		operation: operation,
		type: 'WorkflowHook',
		trigger: {
			source: type,
			simulate: false,
		},
		service: {
			id: config.serviceId,
			name: config.serviceName
		},
		callbackUrl: `/api/c/${config.app}${config.serviceEndpoint}/utils/callback`,
		headers: commonUtils.generateHeaders(txnId),
		properties: commonUtils.generateProperties(txnId),
		workFlowId: workFlowId,
		docId: docId,
		data: {
			old: _data.data.old,
			new: _data.data.new
		},
		audit: _data.audit,
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
	};
	let streamingPayload = {
		collection: `${config.app}.hook`,
		txnId: txnId,
		retry: 0
	};
	return workflowHooks.reduce(function (_prev, _curr) {
		return _prev.then(() => {
			workflowHookLog['_id'] = crypto.randomBytes(16).toString('hex');
			workflowHookLog.callbackUrl = `${workflowHookLog.callbackUrl}/${workflowHookLog._id}`;
			streamingPayload['_id'] = workflowHookLog['_id'];
			workflowHookLog['name'] = _curr.name;
			workflowHookLog['url'] = _curr.url;
			insertHookLog('WorkflowHook', txnId, workflowHookLog);
			queueMgmt.sendToQueue(streamingPayload);
		});
	}, Promise.resolve());
}

function insertHookLog(_type, _txnId, _data) {
	logger.trace(`[${_txnId}] ${_type} log :: ${JSON.stringify(_data)}`);
	global.logsDB.collection(`${config.app}.hook`).insertOne(_data)
		.then(() => logger.debug(`[${_txnId}] ${_type} log :: ${_data._id}`))
		.catch(_e => logger.error(`[${_txnId}] ${_type} log :: ${_data._id} :: ${_e.message}`));
}

function insertAuditLog(_txnId, _data) {
	logger.trace(`[${_txnId}] Audit log :: ${JSON.stringify(_data)}`);
	global.logsDB.collection(`${_data.colName}`).insertOne(_data)
		.then(() => logger.debug(`[${_txnId}] Audit log :: ${_data._id}`))
		.catch(_e => logger.error(`[${_txnId}] Audit log :: ${_data._id} :: ${_e.message}`));
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
	payload.user = req.headers[global.userHeader];
	payload.data = JSON.parse(JSON.stringify(data));
	payload.trigger.source = options.source;
	payload.trigger.simulate = options.simulate;
	payload.service = {
		id: config.serviceId,
		name: config.serviceName
	};
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
		_id: crypto.randomBytes(16).toString('hex'),
		name: hook.name,
		url: hook.url,
		user: req.headers[global.userHeader],
		txnId: req.headers[global.txnIdHeader],
		status: 'Initiated',
		retry: 0,
		docId: null,
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
		response: {
			headers: {},
			body: {}
		},
		_metadata: {
			createdAt: new Date(),
			lastUpdated: new Date()
		}
	};
}

/**
 * 
 * @param {string} url The URL that needs to be invoked
 * @param {*} data The Payload that needs to be sent
 * @param {string} [customErrMsg] The Custom Error Message
 */
function invokeHook(txnId, url, data, customErrMsg, _headers) {
	let timeout = (process.env.HOOK_CONNECTION_TIMEOUT && parseInt(process.env.HOOK_CONNECTION_TIMEOUT)) || 30;
	data.properties = data.properties || commonUtils.generateProperties(txnId);
	let headers = _headers || commonUtils.generateHeaders(txnId);
	headers['Content-Type'] = 'application/json';
	headers['TxnId'] = txnId;
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
		// .then(res => res)
		.catch(err => {
			logger.error(`Error requesting hook :: ${url} :: ${err.message}`);
			const message = customErrMsg ? customErrMsg : `Pre-save "${data.name}" down! Unable to proceed.`;
			throw ({
				message: message,
				response: err.response
			});
		});
}

/**
* 
* @param {*} req Incoming request Object
* @param {*} res Server response Object
*/
function callExperienceHook(req, res) {
	const txnId = req.headers[global.txnIdHeader];
	const user = req.headers[global.userHeader];
	const hookName = req.query.name;
	const payload = req.body || {};
	let docId = null;
	if (payload && payload.data && payload.data._id) docId = payload.data._id;

	let hooks;
	try {
		hooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8')).experienceHooks;
		logger.trace(`[${txnId}] Experience hook :: Hooks :: ${JSON.stringify(hooks)}`);
	} catch (e) {
		logger.erorr(`[${txnId}] Experience hook :: Parse error :: ${e.message}`);
		return res.status(500).json({ message: `Parsing error ${e.message}` });
	}
	try {
		const wantedHook = hooks.find(hook => hookName == hook.name);
		if (!wantedHook) {
			logger.error(`[${txnId}] Experience hook :: ${hookName} :: Not found`);
			return res.status(400).json({ message: `Invalid experience hook ${hookName}` });
		}
		logger.debug(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url}`);

		let headers = commonUtils.generateHeaders(txnId);
		headers['Content-Type'] = 'application/json';
		headers['TxnId'] = txnId;
		headers['User'] = user;

		const data = {
			data: payload.data,
			docId: docId,
			txnId: txnId,
			user: user,
			type: 'ExperienceHook',
			service: {
				id: config.serviceId,
				name: config.serviceName
			},
			properties: commonUtils.generateProperties(txnId),
			name: wantedHook.name,
			url: wantedHook.url,
			label: wantedHook.label
		};

		const options = {
			url: wantedHook.url,
			method: 'POST',
			headers: headers,
			body: data,
			json: true
		};
		return httpClient.httpRequest(options)
			.then(hookResponse => {
				if (!hookResponse) {
					let message = wantedHook.errorMessage || `Experience hook link ${wantedHook.url} down! Unable to proceed.`;
					logger.error(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: Link has no power`);
					data['status'] = 'Fail';
					data['message'] = message;
					data['statusCode'] = hookResponse.statusCode;
					res.status(500).json({ message });
				} else if (hookResponse.statusCode >= 200 && hookResponse.statusCode < 400) {
					logger.debug(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: Response :: ${hookResponse.statusCode}`);
					logger.trace(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: Body :: ${JSON.stringify(hookResponse.body)}`);
					data['status'] = 'Success';
					data['message'] = hookResponse.statusCode;
					data['statusCode'] = hookResponse.statusCode;
					data['response'] = {
						headers: hookResponse.headers,
						body: hookResponse.body
					};
					data.data = {
						old: payload.data,
						new: hookResponse.body.data
					};
					res.status(200).json(hookResponse.body);
				}
			})
			.catch(err => {
				logger.error(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: ${err.message}`);
				let message = 'Error invoking experience hook. Unable to proceed.';
				if (err.response && err.response.body) {
					if (err.response.body.message) {
						message = err.response.body.message;
						logger.trace(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: Body :: ${JSON.stringify(err.response.body)}`);
					}
					data['response'] = {
						headers: err.response.headers,
						body: err.response.body
					};
				}
				message = wantedHook.errorMessage || message;
				logger.error(`[${txnId}] Experience hook :: ${hookName} :: URL :: ${wantedHook.url} :: Response :: ${err.statusCode}`);
				data['status'] = 'Fail';
				data['message'] = message;
				data['statusCode'] = err.statusCode;
				data.data = {
					old: payload.data,
					new: null
				};
				res.status(500).json({ message });
			})
			.finally(() => {
				data['_id'] = crypto.randomBytes(16).toString('hex');
				data['url'] = wantedHook.url;
				data['_metadata'] = {
					createdAt: new Date(),
					lastUpdated: new Date(),
					version: {
						release: process.env.RELEASE || 'dev'
					}
				};
				if (!config.disableInsights) insertHookLog('ExperienceHook', txnId, data);
			});
	} catch (e) {
		let message;
		if (typeof e === 'string') message = e;
		else message = e.message;
		logger.error(`[${txnId}] Experience hook :: ${hookName} :: ${message}`);
		return res.status(500).json({ message });
	}
}

function processHooksQueue() {
	// check if this is running inside a worker
	if (global.doNotSubscribe) return;
	logger.info('Starting subscription to hooks channel');
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
	logger.trace('Get hooks');
	try {
		let authorDB = mongoose.connections[1].client.db(config.authorDB);
		authorDB.collection('services').findOne({ _id: config.serviceId }, { projection: { preHooks: 1, wizard: 1, webHooks: 1, workflowHooks: 1} })
			.then(_d => {
				if (!_d) {
					logger.error(`Get hooks :: Unable to find ${config.serviceId}`);
					return;
				}
				logger.trace(`Get hooks :: data :: ${JSON.stringify(_d)}`);
				setHooks(_d);
			});
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
	prepWorkflowHooks,
	callExperienceHook,
	getHooks,
	setHooks,
	insertHookLog,
	insertAuditLog
};