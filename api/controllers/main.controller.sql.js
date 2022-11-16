const router = require('express').Router();
const log4js = require('log4js');
const swaggerParser = require('swagger-parser');
const _ = require('lodash');
const { mssql } = require('@appveen/rest-crud');

const specialFields = require('../utils/special-fields.utils');
const hooksUtils = require('../utils/hooks.utils');
const crudderUtils = require('../utils/crudder.utils');
const schemaUtils = require('../utils/schema.utils');
const serviceData = require('../../service.json');

const logger = log4js.getLogger(global.loggerName);
let crud;
let table;

(async () => {
	crud = new mssql({ connectionString: serviceData.connectors.data.values.connectionString });
	const jsonSchema = schemaUtils.convertToJSONSchema(serviceData.definition);
	await crud.connect();
	// table = crud.table((serviceData.connectors.data.options.tableName || _.snakeCase(serviceData.name)), jsonSchema);
	table = crud.table('drug_repo', jsonSchema);
})();


router.get('/doc', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	try {
		if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			return res.status(403).json({
				message: 'You don\'t have permission to fetch documentation',
			});
		}
		const obj = await swaggerParser.parse('../swagger/swagger.yaml');
		obj.host = req.query.host;
		obj.basePath = req.query.basePath ? req.query.basePath : obj.basePath;
		addAuthHeader(obj.paths, req.query.token);
		res.status(200).json(obj);
	} catch (err) {
		handleError(res, err, txnId);
	}
});

router.get('/utils/securedFields', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	try {
		if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			return res.status(403).json({
				message: 'You don\'t have permission to fetch secure fields',
			});
		}
		res.status(200).json(specialFields.secureFields);
	} catch (err) {
		handleError(res, err, txnId);
	}
});

/**
 * @deprecated
 */
router.get('/utils/count', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	try {
		let filter = {};
		if (filter) {
			filter = crudderUtils.parseFilter(filter);
		}

		if (!serviceData.schemaFree) {
			const dynamicFilter = await specialFields.getDynamicFilter(req);
			if (dynamicFilter && !_.isEmpty(dynamicFilter)) {
				filter = { $and: [filter, dynamicFilter] };
			}
		}
		await crud.connect();
		const count = await table.count(filter);
		res.status(200).json(count);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.get('/', async (req, res) => {
	let txnId = req.get('txnId');
	try {
		let filter = {};
		if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			logger.error(`[${txnId}] User does not have permission to fetch records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
			return res.status(403).json({
				message: 'You don\'t have permission to fetch records',
			});
		}

		if (filter) {
			filter = crudderUtils.parseFilter(filter);
		}

		if (req.query.countOnly) {
			const count = await count(filter);
			return res.status(200).json(count);
		}
		await crud.connect();
		const docs = await table.list(req.query);
		res.status(200).json(docs);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.get('/:id', async (req, res) => {
	let txnId = req.get('txnId');
	try {
		let id = req.params.id;
		logger.debug(`[${txnId}] Get request received for ${id}`);

		if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			logger.error(`[${txnId}] User does not have permission to fetch records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
			return res.status(403).json({
				message: 'You don\'t have permission to fetch a record',
			});
		}
		await crud.connect();
		const doc = await table.show(id, req.query);
		res.status(200).json(doc);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.post('/', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	let payload = req.body;

	if (!specialFields.hasPermissionForPOST(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		logger.error(`[${txnId}] User does not have permission to create records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
		return res.status(403).json({
			message: 'You don\'t have permission to create records',
		});
	}

	try {
		await crud.connect();
		const status = await table.create(payload);
		res.status(200).json(status);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.put('/:id', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	let id = req.params.id;
	let payload = req.body;

	if (!specialFields.hasPermissionForPUT(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		logger.error(`[${txnId}] User does not have permission to update records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
		return res.status(403).json({
			message: 'You don\'t have permission to update records',
		});
	}

	try {
		await crud.connect();
		const status = await table.update(id, payload);
		logger.debug(`[${txnId}] Update status - ${status}`);
		return res.status(200).json(status);
	} catch (e) {
		handleError(res, e, txnId);
	}
});

router.delete('/:id', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	let id = req.params.id;
	logger.debug(`[${txnId}] Delete request received for record ${id}`);

	if (!specialFields.hasPermissionForDELETE(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		logger.error(`[${txnId}] User does not have permission to update/delete records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
		return res.status(403).json({
			message: 'You don\'t have permission to update records',
		});
	}

	try {
		await crud.connect();
		const status = await table.delete(id);
		logger.trace(`[${txnId}] Deleted documnet ${id} :: ${status}`);
		res.status(200).json({
			message: 'Document Deleted',
		});
	} catch (e) {
		handleError(res, e, txnId);
	}
});

// WHAT is THIS?
router.post('/hook', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	try {
		const url = req.query.url;
		const payload = req.body;
		if (!url) {
			return res.status(400).json({
				message: 'URL is Mandatory',
			});
		}
		try {
			const httpRes = await hooksUtils.invokeHook({ txnId, hook: { url }, payload });
			res.status(200).json(httpRes);
		} catch (e) {
			res.status(400).json({
				message: e.message,
			});
		}
	} catch (e) {
		handleError(res, e, txnId);
	}
});

function addAuthHeader(paths, jwt) {
	Object.keys(paths).forEach((path) => {
		Object.keys(paths[path]).forEach((method) => {
			if (
				typeof paths[path][method] == 'object' &&
				paths[path][method]['parameters']
			) {
				let authObj = paths[path][method]['parameters'].find(
					(obj) => obj.name == 'authorization'
				);
				if (authObj) authObj.default = jwt;
			}
		});
	});
}


function handleError(res, err, txnId) {
	let message;
	logger.error(`[${txnId}] : Some Error Occured :: `, err);
	if (err.response) {
		if (err.response.body) {
			if (typeof err.response.body === 'string') {
				try {
					err.response.body = JSON.parse(err.response.body);
				} catch (e) {
					logger.error(`[${txnId}] : Error While Parsing Error Body`);
				}
			}
			if (err.response.body.message) {
				message = err.response.body.message;
			} else {
				message = err.response.body;
			}
		} else {
			message = `[${txnId}] : ${err.message}`;
		}
	} else if (typeof err === 'string') {
		message = err;
	} else {
		message = err.message;
	}
	res.status(500).json({ message });
	// throw new Error(message);
}


function addExpireAt(req) {
	let expireAt = null;
	if (req.query.expireAt) {
		expireAt = req.query.expireAt;
		if (!isNaN(expireAt)) {
			expireAt = parseInt(req.query.expireAt);
		}
		expireAt = new Date(expireAt);
	} else if (req.query.expireAfter) {
		let expireAfter = req.query.expireAfter;
		let addTime = 0;
		let time = {
			s: 1000,
			m: 60000,
			h: 3600000
		};
		let timeUnit = expireAfter.charAt(expireAfter.length - 1);
		if (!isNaN(timeUnit)) addTime = parseInt(expireAfter) * 1000;
		else {
			let timeVal = expireAfter.substr(0, expireAfter.length - 1);
			if (time[timeUnit] && !isNaN(timeVal)) {
				addTime = parseInt(timeVal) * time[timeUnit];
			} else {
				throw new Error('expireAfter value invalid');
			}
		}
		expireAt = new Date().getTime() + addTime;
		expireAt = new Date(expireAt);
	}
	if (expireAt) {
		if (isNaN(expireAt.getTime())) {
			throw new Error('expire value invalid');
		}
		if (Array.isArray(req.body)) {
			let expString = expireAt.toISOString();
			req.body = req.body.map(_d => {
				_d['_expireAt'] = expString;
			});
		} else {
			req.body['_expireAt'] = expireAt.toISOString();
		}
	}
}

module.exports = router;