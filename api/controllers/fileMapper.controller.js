const router = require('express').Router();
const mongoose = require('mongoose');

const commonUtils = require('../utils/common.utils');
const threadUtils = require('../utils/thread.utils');

const logger = global.logger;
const model = mongoose.model('fileMapper');
const fileTransfersModel = mongoose.model('fileTransfers');

router.get('/:fileId/count', (req, res) => {
    async function execute() {
        try {
            const filter = {};
            filter.fileId = req.params.fileId;
            const count = await model.countDocuments(filter);
            res.status(200).json(count);
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

router.get('/:fileId', (req, res) => {
    async function execute() {
        try {
            const filter = {};
            filter.fileId = req.params.fileId;
            let docs = await model.find(filter).lean();
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
    })
});

router.post('/:fileId/create', (req, res) => {
    async function execute() {
        const fileId = req.params.fileId;
        const data = req.body;
        const fileName = data.fileName;
        const startTime = Date.now();
        let endTime;
        try {
            let status = await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: { status: 'Importing' } });
            res.status(202).json({ message: 'Creation Process started...' });

            /**---------- After Response Process ------------*/
            const result = await threadUtils.executeThread('file-mapper-create', {
                req: {
                    headers: req.headers
                },
                fileId,
                data
            });
            status = await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: result });
            endTime = Date.now();
            let socketData = JSON.parse(JSON.stringify(result));
            socketData.fileId = fileId;
            socketData.userId = req.headers[global.userHeader];
            socketData.fileName = fileName;
            logger.debug(socketData);
            commonUtils.informThroughSocket(req, socketData);
        } catch (e) {
            let message;
            if (typeof e === 'string') {
                message = e;
                e = Error(e);
            } else {
                message = e.message;
            }
            await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: { status: 'Error', message } });
            endTime = Date.now();
            throw e;
        } finally {
            logger.debug('=======================================');
            logger.debug('CREATION ENDED :: ', endTime - startTime);
            logger.debug('=======================================');
        }
    }
    execute().catch(err => {
        logger.error(err);
        res.status(500).json({
            message: err.message
        });
    })
});

router.put('/:fileId/mapping', (req, res) => {
    async function execute() {
        const fileId = req.params.fileId;
        const data = req.body;
        const fileName = data.fileName;
        const startTime = Date.now();
        let endTime;
        try {
            res.status(202).json({ message: 'Validation Process Started...' });

            /**---------- After Response Process ------------*/
            const result = await threadUtils.executeThread('file-mapper-validation', {
                req: {
                    headers: req.headers
                },
                fileId,
                data
            });
            status = await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: result });
            endTime = Date.now();
            let socketData = JSON.parse(JSON.stringify(result));
            socketData.fileId = fileId;
            socketData.fileName = fileName;
            socketData.userId = req.headers[global.userHeader];
            logger.debug('socketData', socketData);
            commonUtils.informThroughSocket(req, socketData);
        } catch (e) {
            let message;
            if (typeof e === 'string') {
                message = e;
                e = new Error(e);
            } else {
                message = e.message;
            }
            await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: { status: 'Error', message } });
            endTime = Date.now();
            throw e;
        } finally {
            logger.debug('=======================================');
            logger.debug('VALIDATION ENDED :: ', endTime - startTime);
            logger.debug('=======================================');
        }
    }
    execute().catch(err => {
        logger.error(err);
        res.status(500).json({
            message: err.message
        });
    })
});

router.put('/enrich', (req, res) => {
    async function execute() {
        try {

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
    })
});

module.exports = router;