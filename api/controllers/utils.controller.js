const router = require('express').Router();
const mongoose = require('mongoose');

const config = require('../../config');
const crudderUtils = require('../utils/crudder.utils');

const logger = global.logger;
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
    })
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
    })
});

module.exports = router;