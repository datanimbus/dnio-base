const router = require('express').Router();
const log4js = require('log4js');
const uuid = require('uuid/v1');

const config = require('../../config');
const threadUtils = require('../utils/thread.utils');
const httpClient = require('./../../http-client');
let serviceDetails = require('./../../service.json');

const logger = log4js.getLogger(global.loggerName);

router.get('/download/:id', (req, res) => {
	async function execute() {
		try {
			const id = req.params.id;
			let file;
			try {
				file = (await global.gfsBucketExport.find({ 'metadata.uuid': id }, { limit: 1 }).toArray())[0];
			} catch (e) {
				logger.error(e);
				res.status(500).json({ message: e.message });
			}
			if (!file) {
				return res.status(404).send('File not found');
			}
			const fileName = req.query.filename ? req.query.filename + '.zip' : file.metadata.filename;
			res.set('Content-Type', file.contentType);
			res.set('Content-Disposition', 'attachment; filename="' + fileName + '"');
			const readstream = global.gfsBucketExport.openDownloadStream(file._id);
			readstream.on('error', function (err) {
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

router.post('/', (req, res) => {
	async function execute() {
		try {
			let txnId = req.get(global.txnIdHeader);
			const fileId = uuid();
			let result;
			res.status(200).json({ _id: fileId, message: 'Process queued' });
			if (serviceDetails.schemaFree) {
				result = await threadUtils.executeThread(txnId, 'export-schemafree', {
					fileId,
					reqData: {
						headers: req.headers,
						query: req.body,
						rawHeaders: req.rawHeaders,
						user: req.user
					}
				});
			} else {
				result = await threadUtils.executeThread(txnId, 'export', {
					fileId,
					reqData: {
						headers: req.headers,
						query: req.body,
						rawHeaders: req.rawHeaders,
						user: req.user
					}
				});
			}
			logger.info(`[${txnId}] : File export result :: ${JSON.stringify(result)}`);
			informGW(result, req.get('Authorization'));
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		}
	}
	execute().catch(err => {
		logger.error('Error in /utils/export execute :: ', err);
		if (!res.headersSent) {
			res.status(500).json({
				message: err.message
			});
		}
	});
});

function informGW(data, jwtToken) {

	var options = {
		url: config.baseUrlGW + '/gw/fileStatus/export',
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': jwtToken
		},
		json: true,
		body: data
	};
	httpClient.httpRequest(options);

}

module.exports = router;