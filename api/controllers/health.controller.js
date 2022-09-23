const router = require('express').Router();
const mongoose = require('mongoose');
const log4js = require('log4js');

const client = require('../../queue').client;

const logger = log4js.getLogger(global.loggerName);


router.get('/live', async (req, res) => {
	try {
		logger.trace('Mongo DB State:', mongoose.connection.readyState);
		logger.trace('NATS State:', client && client.nc ? client.nc.connected : null);
		if (mongoose.connection.readyState == 1 && client && client.nc && client.nc.connected) {
			return res.status(200).json();
		} else {
			return res.status(400).json();
		}
	} catch (err) {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	}
});

router.get('/ready', async (req, res) => {
	try {
		if (mongoose.connection.readyState != 1) {
			return res.status(400).end();
		}
		logger.trace('Init State:', global.runInit);
		if (!global.runInit) {
			require('../../init')();
		}
		return res.status(200).json();
	} catch (err) {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	}
});

module.exports = router;