const router = require('express').Router();
const mongoose = require('mongoose');

const config = require('../../config');
const commonUtils = require('../utils/common.utils');
const crudderUtils = require('../utils/crudder.utils');
const threadUtils = require('../utils/thread.utils');

const logger = global.logger;
const fileTransfersModel = mongoose.model('fileTransfers');
const exportsModel = mongoose.model('exports');

router.get('/download/:id', (req, res) => {
    async function execute() {
        try {
            const id = req.params.id;
            let file;
            try {
                file = (await global.gfsBucketExport.find({ "metadata.uuid": id }, { limit: 1 }).toArray())[0];
            } catch (e) {
                logger.error(e);
                res.status(500).json({ message: e.message });
            }
            if (!file) {
                return res.status(404).send('File not found');
            }
            const fileName = req.query.filename ? req.query.filename + '.zip' : file.metadata.filename
            res.set('Content-Type', file.contentType);
            res.set('Content-Disposition', 'attachment; filename="' + fileName + '"');
            const readstream = global.gfsBucketExport.openDownloadStream(file._id);
            readstream.on("error", function (err) {
                logger.error(err);
                res.end();
            });
            readstream.pipe(res);
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

router.get('/', (req, res) => {
    async function execute() {
        try {
            const _id = uuid();
            const fileName = config.serviceName + '_' + Date.now() + '.xlsx';
            const serviceModel = mongoose.model(config.serviceId);
            let filter = {};
            try {
                if (req.query.filter) {
                    filter = JSON.parse(req.query.filter);
                    filter = crudderUtils.parseFilter(filter);
                }
            } catch (e) {
                logger.error(e);
                return res.status(400).json({
                    message: e
                });
            }
            let select = '';
            let sort = '';
            if (req.query.select && req.query.select.trim()) {
                select = req.query.select.split(',').join(' ');
            }
            if (req.query.sort && req.query.sort.trim()) {
                sort = req.query.sort.split(',').join(' ');
            }
            const data = {
                _id,
                fileName,
                status: 'Pending',
                user: req.headers[global.userHeader],
                type: 'export',
                _metadata: {
                    deleted: false,
                    lastUpdated: new Date(),
                    createdAt: new Date()
                }
            };
            const totalRecords = await serviceModel.countDocuments(filter);
            data.validCount = totalRecords;
            let transferDoc = new fileTransfersModel(data);
            transferDoc._req = req;
            transferDoc = await transferDoc.save();
            
            const docs = await serviceModel.find(filter).select(select).sort(sort).lean();
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