const router = require('express').Router();

router.use('/', require('./main.controller'));
router.use('/utils/workflow', require('./workflow.controller'));
router.use('/utils/fileTransfers', require('./fileTransfers.controller'));
router.use('/utils', require('./utils.controller'));
router.use('/file', require('./file.controller'));
router.use('/fileMapper', require('./fileMapper.controller'));
router.use('/utils/export', require('./export.controller'));
router.use('/health', require('./health.controller'));

module.exports = router;