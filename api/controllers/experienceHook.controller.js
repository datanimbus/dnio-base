const router = require('express').Router();
const log4js = require('log4js');

const hooksUtils = require('../utils/hooks.utils');

const logger = log4js.getLogger(global.loggerName);

router.post('/', (req, res) => {
	const txnId = req.get(global.txnIdHeader);
	async function execute() {
		try {
			const name = req.query.name;
			logger.info(`[${txnId}] Experience hook :: ${name}`);
			if (!name) {
				logger.error(`[${txnId}] Experience hook :: ${name} :: Missing name`);
				return res.status(400).json({ message: 'Name is Mandatory' });
			}

			const payload = req.body || {};
			logger.trace(`[${txnId}] Experience hook :: ${JSON.stringify(payload)}`);
	
			hooksUtils.callExperienceHook(req, res);
		} catch (e) {
			if (typeof e === 'string') throw new Error(e);
			throw e;
		}
	}

	execute().catch(err => {
		logger.error(`[${txnId}] Error in experienceHook :: ${err.message}`);
		res.status(500).json({message: err.message });
	});
});

module.exports = router;