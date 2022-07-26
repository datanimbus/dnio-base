const router = require('express').Router();
const mongoose = require('mongoose');
const log4js = require('log4js');

const config = require('../../config');
const crudderUtils = require('../utils/crudder.utils');
const workflowUtils = require('../utils/workflow.utils');
const specialUtils = require('../utils/special-fields.utils');
const commonUtils = require('../utils/common.utils');

const logger = log4js.getLogger(global.loggerName);
const model = mongoose.model(config.serviceId);

router.post('/aggregate', async (req, res) => {
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
	} catch (err) {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	}
});

router.put('/hrefUpdate', async (req, res) => {
	try {
		global.outgoingAPIs[req.body.id] = req.body;
		res.status(200).json({ message: 'Href Updated' });
	} catch (err) {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	}
});

router.post('/simulate', async (req, res) => {
	try {
		const payload = req.body;
		const operation = req.query.operation;
		const data = await workflowUtils.simulate(req, payload, { simulate: true, source: 'simulate', trigger: 'form-submit', operation: operation });
		res.status(200).json(data);
	} catch (err) {
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
	}
});


router.get('/dynamicFilter/:userId', async (req, res) => {
	try {
		if (!req.params.userId) {
			return res.status(400).json({ message: 'User ID is required' })
		}
		const user = await commonUtils.getUserDoc(req, req.params.userId);
		const filter = await specialUtils.getDynamicFilter({ user });
		res.status(200).json({ filter });
	} catch (err) {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	}
});

module.exports = router;