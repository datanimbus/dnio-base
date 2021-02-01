const router = require('express').Router();
const mongoose = require('mongoose');
const client = require('../../queue').client;

const init = require('../../init');

const logger = global.logger;
let runInit = true;

router.get('/live', (req, res) => {
    async function execute() {
        try {
            if (mongoose.connection.readyState === 1 && client && client.nc && client.nc.connected) {
                return res.status(200).json();
            } else {
                return res.status(400).json();
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
    });
});

router.get('/ready', (req, res) => {
    async function execute() {
        try {
            if (mongoose.connection.readyState != 1) {
                return res.status(400).end();
            }
            logger.info('Checking runInit :: ', runInit)
            if (!runInit) {
                res.end();
            }
            try {
                await init();
                logger.info('Ran init :: ', runInit)
                runInit = false;
                res.end();
            } catch (e) {
                logger.error(e);
                res.status(400).end();
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