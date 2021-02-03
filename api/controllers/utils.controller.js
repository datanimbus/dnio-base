const router = require('express').Router();
const mongoose = require('mongoose');

const config = require('../../config');
const crudderUtils = require('../utils/crudder.utils');
const hooksUtils = require('../utils/hooks.utils');
const specialFields = require('../utils/special-fields.utils');

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

router.post('/simulate', (req, res) => {
    async function execute() {
        try {
            const payload = req.body;
            let errors = await specialFields.fixBoolean(req, payload, null);
            if (errors) {
                logger.error(errors);
                return res.status(400).json({
                    message: err.message
                });
            }
            errors = await specialFields.validateCreateOnly(req, payload, null);
            if (errors) {
                logger.error(errors);
                return res.status(400).json({
                    message: err.message
                });
            }
            errors = await specialFields.validateRelation(req, payload, null);
            if (errors) {
                logger.error(errors);
                return res.status(400).json({
                    message: err.message
                });
            }
            errors = await specialFields.validateUnique(req, payload, null);
            if (errors) {
                logger.error(errors);
                return res.status(400).json({
                    message: err.message
                });
            }
            errors = await specialFields.validateDateFields(req, payload, null);
            if (errors) {
                logger.error(errors);
                return res.status(400).json({
                    message: err.message
                });
            }
            try {
                const data = await hooksUtils.callAllPreHooks(req, payload, { operation: '', source: 'simulate', simulate: true })
                res.status(200).json(data);
            } catch (e) {
                logger.error(e);
                res.status(400).json({
                    message: e.message
                });
            }
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