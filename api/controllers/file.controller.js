const router = require('express').Router();
const uuid = require('uuid/v1');
const log4js = require('log4js');
const mongoose = require('mongoose');
const moment = require('moment');
const storageEngine = require('@appveen/data.stack-utils').storageEngine;

const fs = require('fs');
const crypto = require('crypto');

const config = require('../../config');

const logger = log4js.getLogger(global.loggerName);

router.get('/:id/view', (req, res) => {
	async function execute() {
		try {
			const id = req.params.id;
			const storage = config.fileStorage.storage;
			let txnId = req.get('txnid');

			logger.info(`[${txnId}] File view request received for id ${id}`);
			logger.info(`[${txnId}] Storage Enigne - ${storage}`);

			if (storage === 'GRIDFS') {
				let file;
				try {
					file = (await global.gfsBucket.find({ filename: id }).toArray())[0];
				} catch (e) {
					logger.error(`[${txnId}] Error finding file - ${e}`);
					return res.status(500).json({ message: e.message });
				}
				if (!file) {
					logger.error(`[${txnId}] File Not Found`);
					return res.status(400).json({ message: 'File not found' });
				}
				const readstream = global.gfsBucket.openDownloadStream(file._id);
				readstream.on('error', function (err) {
					logger.error(err);
					return res.end();
				});
				readstream.pipe(res);
			} else if (storage === 'AZURE') {
				return await downloadFileFromAzure(id, storage, txnId, res);
			} else {
				logger.error(`[${txnId}] External Storage type is not allowed`);
				throw new Error(`External Storage ${storage} not allowed`);
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

router.get('/download/:id', (req, res) => {
	async function execute() {
		try {
			const id = req.params.id;
			const storage = config.fileStorage.storage;
			let txnId = req.get('txnid');

			logger.info(`[${txnId}] File download request received for id ${id}`);
			logger.info(`[${txnId}] Storage Enigne - ${storage}`);

			if (storage === 'GRIDFS') {
				let file;
				try {
					file = (await global.gfsBucket.find({ filename: id }).toArray())[0];
				} catch (e) {
					logger.error(`[${txnId}] Error finding file - ${e}`);
					return res.status(500).json({ message: e.message });
				}
				if (!file) {
					return res.status(400).json({ message: 'File not found' });
				}
				res.set('Content-Type', file.contentType);
				res.set('Content-Disposition', 'attachment; filename="' + file.metadata.filename + '"');
				const readstream = global.gfsBucket.openDownloadStream(file._id);
				readstream.on('error', function (err) {
					logger.error(`[${txnId}] Error streaming file - ${err}`);
					return res.end();
				});
				readstream.pipe(res);

			} else if (storage === 'AZURE') {
				return await downloadFileFromAzure(id, storage, txnId, res);
			} else {
				logger.error(`[${txnId}] External Storage type is not allowed`);
				throw new Error(`External Storage ${storage} not allowed`);
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

router.post('/upload', (req, res) => {
	async function execute() {
		try {
			const storage = config.fileStorage.storage;
			let txnId = req.get('txnid');

			logger.info(`[${txnId}] File upload request received`);
			logger.info(`[${txnId}] Storage Enigne -  ${config.fileStorage.storage}`);

			const sampleFile = req.file;
			const filename = sampleFile.originalname;

			if (storage === 'GRIDFS') {
				fs.createReadStream(sampleFile.path).
					pipe(global.gfsBucket.openUploadStream(crypto.createHash('md5').update(uuid() + global.serverStartTime).digest('hex'), {
						contentType: sampleFile.mimetype,
						metadata: { filename }
					})).
					on('error', function (error) {
						logger.error(`[${txnId}] Error uploading file - ${error}`);

						return res.status(500).json({
							message: `Error uploading File - ${error.message}`
						});
					}).
					on('finish', function (file) {
						logger.info(`[${txnId}] File uploaded to GridFS`);
						logger.trace(`[${txnId}] File details - ${JSON.stringify(file)}`);

						return res.status(200).json(file);
					});

			} else if (storage === 'AZURE') {
				try {
					let file = await createFileObject(req.file);

					logger.trace(`[${txnId}] File object details - ${JSON.stringify(file)}`);

					let pathFile = JSON.parse(JSON.stringify(file));
					pathFile.path = req.file.path;

					await storageEngine.azureBlob.uploadFile(pathFile,
						config.fileStorage[storage].connectionString,
						config.fileStorage[storage].container,
						config.app,
						config.serviceName);

					let resp = await mongoose.model('files').create(file);

					file._id = resp._id;
					
					logger.info(`[${txnId}] File uploaded to Azure`);
					logger.trace(`[${txnId}] File details - ${JSON.stringify(file)}`);

					return res.status(200).json(file);
				} catch (error) {
					logger.error(`[${txnId}] Error while upploading file - ${error}`);

					return res.status(500).json({
						message: `Error uploading file - ${error.message}`
					});
				}
			} else {
				logger.error(`[${txnId}] External Storage type is not allowed`);
				throw new Error(`External Storage ${storage} not allowed`);
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

async function downloadFileFromAzure(id, storage, txnId, res) {
	try {
		let file = await mongoose.model('files').findOne({ filename: id });

		if (!file) {
			logger.error(`[${txnId}] File not found`);
			throw new Error(`File Not Found`);
		}

		logger.debug(`[${txnId}] File Found, generating download link.`);
		logger.trace(`[${txnId}] File details - ${JSON.stringify(file)}`);

		let downloadUrl = await storageEngine.azureBlob.downloadFileLink(file, config.fileStorage[storage].connectionString,
			config.fileStorage[storage].container,
			config.fileStorage[storage].sharedKey,
			config.fileStorage[storage].timeout);

		logger.debug(`[${txnId}] Redirecting response to Azure download link`);

		return res.redirect(downloadUrl);
	} catch (err) {
		logger.error(`[${txnId}] Error downloading file - ${err.message}`);
		return res.end();
	}
}

// Read a request file object and convert to ds file object format
async function createFileObject(file) {
	let fileObj = {};
	fileObj.length = file.size;
	fileObj.uploadDate = moment().format('YYYY-MM-DDTHH:mm:ss');
	fileObj.filename = file.filename + '.' + file.originalname.split('.').pop();
	fileObj.contentType = file.mimetype;
	fileObj.metadata = { filename: file.originalname };
	fileObj.md5 = await createMD5Hash(file);

	return fileObj;
}

// Create md5 hash of file data
async function createMD5Hash(file) {
	return new Promise((resolve, reject) => {
		const stream = fs.createReadStream(file.path);
		const hash = crypto.createHash('md5');

		stream.on('error', err => reject(err));
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

module.exports = router;
