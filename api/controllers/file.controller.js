const router = require('express').Router();
const streamifier = require('streamifier');

const logger = global.logger;

router.get('/:id/view', (req, res) => {
    async function execute() {
        try {
            const id = req.params.id;
            let file;
            try {
                file = (await global.gfsBucket.find({ filename: id }).toArray())[0];
            } catch (e) {
                logger.error(e);
                res.status(500).json({ message: e.message });
            }
            if (!file) {
                return res.status(400).json({ message: 'File not found' });
            }
            const readstream = global.gfsBucket.openDownloadStream(file._id);
            readstream.on('error', function (err) {
                logger.error(err);
                return res.end();
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
    })
});

router.get('/download/:id', (req, res) => {
    async function execute() {
        try {
            const id = req.params.id;
            let file;
            try {
                file = (await global.gfsBucket.find({ filename: id }).toArray())[0];
            } catch (e) {
                logger.error(e);
                res.status(500).json({ message: e.message });
            }
            if (!file) {
                return res.status(400).json({ message: 'File not found' });
            }
            res.set('Content-Type', file.contentType);
            res.set('Content-Disposition', 'attachment; filename="' + file.metadata.filename + '"');
            const readstream = global.gfsBucket.openDownloadStream(file._id);
            readstream.on('error', function (err) {
                logger.error(err);
                return res.end();
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
    })
});

router.post('/upload', (req, res) => {
    async function execute() {
        try {
            const sampleFile = req.file.file;
            const filename = sampleFile.name;
            streamifier.createReadStream(sampleFile.data).
                pipe(global.gfsBucket.openUploadStream(crypto.createHash('md5').update(uuid() + global.serverStartTime).digest('hex'), {
                    contentType: sampleFile.mimetype,
                    metadata: { filename }
                })).
                on('error', function (error) {
                    logger.error(error);
                    res.status(500).json({
                        message: error.message
                    });
                }).
                on('finish', function (file) {
                    logger.debug('File uploaded to gridFS');
                    res.status(200).json(file);
                });
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

module.exports = router;