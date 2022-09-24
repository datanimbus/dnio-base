const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const uuid = require('uuid/v1');
const log4js = require('log4js');
const mongoose = require('mongoose');

const config = require('../../config');
const queueMgmt = require('../../queue');
const httpClient = require('../../http-client');
const commonUtils = require('./common.utils');


const logger = log4js.getLogger(global.loggerName);
const client = queueMgmt.client;

client.on('connect', () => {
	getHooks();
	// processHooksQueue();
});

client.on('reconnect', () => {
	getHooks();
	// processHooksQueue();
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
	let txnId = req.headers[global.txnIdHeader] || req.headers['TxnId'] || req.headers.txnid;
	options['type'] = 'PreHook';
	logger.debug(`[${txnId}] PreHook :: ${data._id} :: Options :: ${JSON.stringify(options)}`);
	logger.trace(`[${txnId}] PreHook :: ${data._id} :: ${JSON.stringify(data)}`);
	let preHooks = [];
	try {
		preHooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8')).preHooks;
	} catch (e) {
		logger.error(`[${txnId}] PreHook :: ${data._id} :: Parser error :: ${e.message}`);
	}
	logger.trace(`[${txnId}] PreHook :: ${data._id} :: ${preHooks.length} found`);
	preHooks.forEach(_d => logger.debug(`[${txnId}] PreHook :: ${data._id} :: ${_d.name} - ${_d.url} `));
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
			if (curr.type === 'function') {
				return invokeFunction({ txnId, hook: curr, payload, headers }, req);
			} else {
				return invokeHook({ txnId, hook: curr, payload, headers });
			}
		}).then(_response => {
			newData = _.mergeWith(oldData, _response.body.data, commonUtils.mergeCustomizer);
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
			if (!config.disableInsights && preHookLog && preHookLog._id) insertHookLog('PreHook', txnId, JSON.parse(JSON.stringify(preHookLog)));
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
	if (!postHooks) {
		postHooks = [];
	}
	let operation = 'POST';
	let docId = _data.new._id;
	if (_data.old && _data.new) operation = 'PUT';
	if (_data.old && !_data.new) {
		operation = 'DELETE';
		docId = _data.old._id;
	}
	logger.debug(`[${txnId}] PostHook :: ${docId} :: ${postHooks.length} found`);
	postHooks = postHooks.map(_d => {
		// if (_d.type === 'function') {
		// 	_d.url = config.baseUrlGW + _d.url;
		// }
		logger.debug(`[${txnId}] PostHook :: ${docId} :: ${_d.name} - ${_d.url} `);
		return _d;
	});
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
	return postHooks.reduce(function (_prev, _curr) {
		return _prev.then(() => {
			const streamingPayload = {
				collection: `${config.app}.hook`,
				txnId: txnId,
				retry: 0
			};
			const temp = JSON.parse(JSON.stringify(postHookLog));
			temp['_id'] = uuid();
			temp.callbackUrl = `${temp.callbackUrl}/${temp._id}`;
			streamingPayload['_id'] = temp['_id'];
			temp['name'] = _curr.name;
			temp['url'] = _curr.url;
			temp['hookType'] = (_curr.type || 'external');
			temp['refId'] = _curr.refId;
			insertHookLog('PostHook', txnId, temp);
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
	logger.debug(`[${txnId}] WorkflowHooks :: ${workFlowId} :: Status :: ${type.toUpperCase()}`);
	let workflowHooks = [];
	try {
		const hooks = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'hooks.json'), 'utf-8'));
		workflowHooks = hooks.workflowHooks && hooks.workflowHooks.postHooks ? hooks.workflowHooks.postHooks[_data.type] : [];
	} catch (e) {
		logger.error(`[${txnId}] WorkflowHooks :: ${workFlowId} :: Parser error :: ${e.message}`);
		throw e;
	}
	logger.debug(`[${txnId}] WorkflowHooks :: ${workFlowId} :: ${workflowHooks.length} found`);
	workflowHooks.forEach(_d => logger.debug(`[${txnId}] WorkflowHooks :: ${workFlowId} :: ${_d.name} - ${_d.url} `));
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
	return workflowHooks.reduce(function (_prev, _curr) {
		return _prev.then(() => {
			const streamingPayload = {
				collection: `${config.app}.hook`,
				txnId: txnId,
				retry: 0
			};
			const temp = JSON.parse(JSON.stringify(workflowHookLog));
			temp['_id'] = uuid();
			temp.callbackUrl = `${temp.callbackUrl}/${temp._id}`;
			streamingPayload['_id'] = temp['_id'];
			temp['name'] = _curr.name;
			temp['url'] = _curr.url;
			temp['hookType'] = (_curr.type || 'external');
			temp['refId'] = _curr.refId;
			insertHookLog('WorkflowHook', txnId, temp);
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
		_id: uuid(),
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
 * @param {string} txnId The txnID of the request
 * @param {object} data Options 
 * @param {object} data.hook The Hook Data
 * @param {string} data.hook.url Hook URL
 * @param {string} data.hook.name Hook Name
 * @param {string} data.hook.type Type of Hook
 * @param {string} data.hook.failMessage The Custom Error Message
 * @param {object} data.payload The Payload that needs to be sent
 * @param {string} data.headers Additional Headers
 * @param {string} data.txnId The TxnId of the Request
 */
function invokeHook(data) {
	let timeout = (process.env.HOOK_CONNECTION_TIMEOUT && parseInt(process.env.HOOK_CONNECTION_TIMEOUT)) || 30;
	data.payload.properties = data.payload.properties || commonUtils.generateProperties(data.txnId);
	let headers = data.headers || commonUtils.generateHeaders(data.txnId);
	headers['Content-Type'] = 'application/json';
	headers['TxnId'] = data.txnId;
	var options = {
		url: data.hook.url,
		method: 'POST',
		headers: headers,
		json: true,
		body: data.payload,
		timeout: timeout * 1000
	};
	if (typeof process.env.TLS_REJECT_UNAUTHORIZED === 'string' && process.env.TLS_REJECT_UNAUTHORIZED.toLowerCase() === 'false') {
		options.insecure = true;
		options.rejectUnauthorized = false;
	}
	return httpClient.httpRequest(options)
		// .then(res => res)
		.catch(err => {
			logger.error(`Error requesting hook :: ${options.url} :: ${err.message}`);
			const message = data.hook.failMessage ? data.hook.failMessage : `Pre-save "${data.hook.name}" down! Unable to proceed.`;
			throw ({
				message: message,
				response: err.response
			});
		});
}

/**
 * @param {string} txnId The txnID of the request
 * @param {object} data Options 
 * @param {object} data.hook The Hook Data
 * @param {string} data.hook.url Hook URL
 * @param {string} data.hook.name Hook Name
 * @param {string} data.hook.type Type of Hook
 * @param {string} data.hook.failMessage The Custom Error Message
 * @param {object} data.payload The Payload that needs to be sent
 * @param {string} data.headers Additional Headers
 * @param {string} data.txnId The TxnId of the Request
 */
function invokeFunction(data, req) {
	let timeout = (process.env.HOOK_CONNECTION_TIMEOUT && parseInt(process.env.HOOK_CONNECTION_TIMEOUT)) || 30;
	data.payload.properties = data.payload.properties || commonUtils.generateProperties(data.txnId);
	let headers = data.headers || commonUtils.generateHeaders(data.txnId);
	headers['Content-Type'] = 'application/json';
	headers['TxnId'] = data.txnId;
	headers['Authorization'] = req.headers['authorization'];
	var options = {
		url: config.baseUrlGW + data.hook.url,
		method: 'POST',
		headers: headers,
		json: true,
		body: data.payload,
		timeout: timeout * 1000
	};
	if (typeof process.env.TLS_REJECT_UNAUTHORIZED === 'string' && process.env.TLS_REJECT_UNAUTHORIZED.toLowerCase() === 'false') {
		options.insecure = true;
		options.rejectUnauthorized = false;
	}
	return httpClient.httpRequest(options)
		// .then(res => res)
		.catch(err => {
			logger.error(`Error requesting function :: ${options.url} :: ${err.message}`);
			const message = data.hook.failMessage ? data.hook.failMessage : `Pre-save "${data.hook.name}" down! Unable to proceed.`;
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
				data['_id'] = uuid();
				data['url'] = wantedHook.url;
				data['_metadata'] = {
					createdAt: new Date(),
					lastUpdated: new Date(),
					version: {
						release: process.env.RELEASE || 'dev'
					}
				};
				if (!config.disableInsights) insertHookLog('ExperienceHook', txnId, JSON.parse(JSON.stringify(data)));
			});
	} catch (e) {
		let message;
		if (typeof e === 'string') message = e;
		else message = e.message;
		logger.error(`[${txnId}] Experience hook :: ${hookName} :: ${message}`);
		return res.status(500).json({ message });
	}
}

// function processHooksQueue() {
// 	// check if this is running inside a worker
// 	if (global.doNotSubscribe) return;
// 	logger.info('Starting subscription to hooks channel');
// 	try {
// 		var opts = client.subscriptionOptions();
// 		opts.setStartWithLastReceived();
// 		opts.setDurableName(config.serviceId + '-hooks-durable');
// 		var subscription = client.subscribe('sm-hooks', opts);
// 		subscription.on('message', function (_body) {
// 			try {
// 				let bodyObj = JSON.parse(_body.getData());
// 				logger.debug(`Message from hooks channel :: ${config.serviceId}-hooks :: ${JSON.stringify(bodyObj)}`);
// 				setHooks(bodyObj);
// 			} catch (err) {
// 				logger.error(`Error processing hooks message :: ${err.message}`);
// 			}
// 		});
// 	} catch (err) {
// 		logger.error(`Hooks channel :: ${err.message}`);
// 	}
// }

async function setHooks(data) {
	try {
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
	} catch (err) {
		logger.error(`Set hooks :: ${err}`);
	}
}

async function getHooks() {
	logger.trace('Get hooks');
	try {
		let authorDB = mongoose.connections[1].client.db(config.authorDB);
		authorDB.collection('services').findOne({ _id: config.serviceId }, { projection: { preHooks: 1, wizard: 1, webHooks: 1, workflowHooks: 1 } })
			.then(_d => {
				if (!_d) {
					logger.error(`Get hooks :: Unable to find ${config.serviceId}`);
					return;
				}
				logger.trace(`Get hooks :: data :: ${JSON.stringify(_d)}`);
				setHooks(_d);
			});
	} catch (err) {
		logger.error(`Get hooks :: ${err}`);
	}
}

function createExperienceHooksList(data) {
	try {
		let hooks = [];
		let wizard = data.wizard;
		if (wizard) {
			hooks = [].concat.apply([], wizard.map(_d => _d.actions));
			logger.trace(`Experience hooks - ${JSON.stringify(hooks)}`);
		}
		return hooks;
	} catch (err) {
		logger.error(`createExperienceHooksList :: ${err}`);
	}
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