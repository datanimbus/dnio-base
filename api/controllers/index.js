const serviceDoc = require('../../service.json');

const router = require('express').Router();

if (serviceDoc && serviceDoc.connectors && serviceDoc.connectors.data && serviceDoc.connectors.data.type !== 'MONGODB') {
	router.use('/', require('./main.controller.sql'));
} else {
	router.use('/', require('./main.controller'));
	router.use('/utils', require('./utils.controller'));
	router.use('/utils/callback', require('./callback.controller'));
	router.use('/utils/dedupe', require('./dedupe.controller'));
	router.use('/utils/experienceHook', require('./experienceHook.controller'));
	router.use('/utils/export', require('./export.controller'));
	router.use('/utils/file', require('./file.controller'));
	router.use('/utils/fileMapper', require('./fileMapper.controller'));
	router.use('/utils/fileTransfers', require('./fileTransfers.controller'));
	// router.use('/utils/health', require('./health.controller'));
	router.use('/utils/workflow', require('./workflow.controller'));
	router.use('/utils/sec', require('./security.controller'));
}

module.exports = router;