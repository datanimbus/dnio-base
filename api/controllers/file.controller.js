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
			logger.info(`[${req.get(txnid)}] File view request received for id ${id}`);

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
	});
});

router.get('/download/:id', (req, res) => {
	async function execute() {
		try {
			const id = req.params.id;
			const storage = config.fileStorage.storage;

			logger.info(`[${req.get(txnid)}] File download request received for id ${id}`);
			logger.info(`[${req.get(txnid)}] Storage Enigne - ${storage}`);

			if (storage === 'GRIDFS') {
				let file;
				try {
					file = (await global.gfsBucket.find({ filename: id }).toArray())[0];
				} catch (e) {
					logger.error(`[${req.get(txnid)}] Error finding file - ${e}`);
					res.status(500).json({ message: e.message });
				}
				if (!file) {
					return res.status(400).json({ message: 'File not found' });
				}
				res.set('Content-Type', file.contentType);
				res.set('Content-Disposition', 'attachment; filename="' + file.metadata.filename + '"');
				const readstream = global.gfsBucket.openDownloadStream(file._id);
				readstream.on('error', function (err) {
					logger.error(`[${req.get(txnid)}] Error streaming file - ${err}`);
					return res.end();
				});
				readstream.pipe(res);

			} else if (storage === 'AZURE') {
				try {
					let file = await mongoose.model('files').findOne({ filename: id });

					logger.debug(`[${req.get(txnid)}] File Found, generating download link.`);
					logger.trace(`[${req.get(txnid)}] File details - ${JSON.stringify(file)}`);

					let downloadUrl = await storageEngine.azureBlob.downloadFileLink(file, config.fileStorage[storage].connectionString,
						config.fileStorage[storage].container,
						config.fileStorage[storage].sharedKey,
						config.fileStorage[storage].timeout);

					logger.debug(`[${req.get(txnid)}] Redirecting response to Azure download link`);

					res.redirect(downloadUrl);
				} catch (err) {
					logger.error(`[${req.get(txnid)}] Error downloading file - ${err.message}`);
					return res.end();
				}
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

			logger.info(`[${req.get(txnid)}] File upload request received`);
			logger.info(`[${req.get(txnid)}] Storage Enigne -  ${config.fileStorage.storage}`);

			const sampleFile = req.file;
			const filename = sampleFile.originalname;

			if (storage === 'GRIDFS') {
				fs.createReadStream(sampleFile.path).
					pipe(global.gfsBucket.openUploadStream(crypto.createHash('md5').update(uuid() + global.serverStartTime).digest('hex'), {
						contentType: sampleFile.mimetype,
						metadata: { filename }
					})).
					on('error', function (error) {
						logger.error(`[${req.get(txnid)}] Error uploading file - ${error}`);

						res.status(500).json({
							message: `Error uploading File - ${error.message}`
						});
					}).
					on('finish', function (file) {
						logger.info(`[${req.get(txnid)}] File uploaded to GridFS`);
						logger.trace(`[${req.get(txnid)}] File details - ${JSON.stringify(file)}`);

						res.status(200).json(file);
					});

			} else if (storage === 'AZURE') {
				try {
					let file = await createFileObject(req.file);

					logger.trace(`[${req.get(txnid)}] File object details - ${JSON.stringify(file)}`);

					let pathFile = JSON.parse(JSON.stringify(file));
					pathFile.path = req.file.path;

					await storageEngine.azureBlob.uploadFile(pathFile,
						config.fileStorage[storage].connectionString, config.fileStorage[storage].container);

					let resp = await mongoose.model('files').create(file);

					file._id = resp._id;
					
					logger.info(`[${req.get(txnid)}] File uploaded to Azure`);
					logger.trace(`[${req.get(txnid)}] File details - ${JSON.stringify(file)}`);

					res.status(200).json(file);
				} catch (error) {
					logger.error(`[${req.get(txnid)}] Error while upploading file - ${error}`);

					res.status(500).json({
						message: `Error uploading file - ${error.message}`
					});
				}
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
