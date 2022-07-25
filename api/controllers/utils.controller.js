const router = require('express').Router();
const mongoose = require('mongoose');
const log4js = require('log4js');

const config = require('../../config');
const crudderUtils = require('../utils/crudder.utils');
const workflowUtils = require('../utils/workflow.utils');
const specialUtils = require('../utils/special-fields.utils');

const logger = log4js.getLogger(global.loggerName);
const model = mongoose.model(config.serviceId);

router.post('/aggregate', (req, res) => {
	async function execute() {
		try {
			const payload = req.body;
			const flag = crudderUtils.validateAggregation(payload);
			if (!flag) {
				return res.status(400).json({
					message: 'Invalid key in aggregation body'
				});
			}
			const docs = await model.aggregate(payload);
			res.status(200).json(docs);
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	});
});

router.put('/hrefUpdate', (req, res) => {
	async function execute() {
		try {
			global.outgoingAPIs[req.body.id] = req.body;
			res.status(200).json({ message: 'Href Updated' });
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	});
});

router.post('/simulate', (req, res) => {
	async function execute() {
		try {
			const payload = req.body;
			const operation = req.query.operation;
			const data = await workflowUtils.simulate(req, payload, { simulate: true, source: 'simulate', trigger: 'form-submit', operation: operation });
			res.status(200).json(data);
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error('Error in simulate api ::', err);
		if (err.source) {
			if (err.error.message) {
				err.message = err.error.message;
			} else {
				let message = '';
				if (typeof err.error === 'object') {
					Object.keys(err.error).forEach(key => {
						message += key + ' : ' + err.error[key] + '\n';
					});
				}
				err.message = message ? message : JSON.stringify(err.error);
			}
		}
		res.status(500).json({
			message: err.message
		});
	});
});


router.get('/dynamicFilter', async (req, res) => {
	try {
		const filter = await specialUtils.getDynamicFilter(req);
		res.status(200).json({ filter });
	} catch (e) {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	}
});

module.exports = router;