const router = require('express').Router();
const uuid = require('uuid/v1');
const log4js = require('log4js');
const mongoose = require('mongoose');
const moment = require('moment');
const commonUtils = require('../utils/common.utils');
const storageEngine = require('@appveen/data.stack-utils').storageEngine;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('../../config');

const logger = log4js.getLogger(global.loggerName);

router.get('/:id/view', (req, res) => {
	async function execute() {
		try {
			const id = req.params.id;
			const storage = config.fileStorage.storage;
			let txnId = req.get('txnid');

			logger.debug(`[${txnId}] File view request received for id ${id}`);
			logger.debug(`[${txnId}] Storage Enigne - ${storage}`);

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
		let tmpDirPath, id;
		try {
			id = req.params.id;
			const storage = config.fileStorage.storage;
			const encryptionKey = req.query.encryptionKey;
			let txnId = req.get('txnid');

			logger.debug(`[${txnId}] File download request received for id ${id}`);
			logger.debug(`[${txnId}] Storage Enigne - ${storage}`);
			logger.debug(`[${txnId}] Encryption Key - ${encryptionKey}`);

			tmpDirPath = path.join(process.cwd(), 'tmp');
			if (!fs.existsSync(tmpDirPath)) {
				fs.mkdirSync(tmpDirPath);
			}

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

				if (encryptionKey) {
					let tmpFilePath = path.join(process.cwd(), 'tmp', id);

					const readStream = global.gfsBucket.openDownloadStream(file._id);
					const writeStream = fs.createWriteStream(tmpFilePath);

					readStream.pipe(writeStream);

					readStream.on('error', function (err) {
						logger.error(`[${txnId}] Error streaming file - ${err}`);
						return res.end();
					});

					writeStream.on('error', function (err) {
						logger.error(`[${txnId}] Error streaming file - ${err}`);
						return res.end();
					});

					writeStream.on('close', async function () {

						await commonUtils.decryptFile({ path: tmpFilePath }, encryptionKey);

						res.set('Content-Type', file.contentType);
						res.set('Content-Disposition', 'attachment; filename="' + file.metadata.filename + '"');

						let tmpReadStream = fs.createReadStream(tmpFilePath + '.dec');
						tmpReadStream.on('error', function (err) {
							logger.error(`[${txnId}] Error streaming file - ${err}`);
							return res.end();
						});

						tmpReadStream.pipe(res);
					});
				} else {
					res.set('Content-Type', file.contentType);
					res.set('Content-Disposition', 'attachment; filename="' + file.metadata.filename + '"');

					const readstream = global.gfsBucket.openDownloadStream(file._id);
					readstream.on('error', function (err) {
						logger.error(`[${txnId}] Error streaming file - ${err}`);
						return res.end();
					});

					readstream.pipe(res);
				}
			} else if (storage === 'AZURE') {
				return await downloadFileFromAzure(id, storage, txnId, res, encryptionKey);
			} else {
				logger.error(`[${txnId}] External Storage type is not allowed`);
				throw new Error(`External Storage ${storage} not allowed`);
			}
		} catch (e) {
			if (typeof e === 'string') {
				throw new Error(e);
			}
			throw e;
		} finally {
			/****** Removing temp files if exist ******/
			let filesToRemove = [path.join(tmpDirPath, id), path.join(tmpDirPath, id + '.dec')];
			filesToRemove.forEach(file => {
				if (fs.existsSync(file)) {
					fs.unlink(file, (err) => {
						if (err) logger.error('Error in deleting file: ' + file, err);
					});
				}
			});
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
		let filePath;
		try {
			const storage = config.fileStorage.storage;
			let txnId = req.get('txnid');
			const sampleFile = req.file;
			const filename = sampleFile.originalname;
			const encryptionKey = req.query.encryptionKey;

			logger.debug(`[${txnId}] File upload request received - ${filename}`);
			logger.debug(`[${txnId}] Storage Enigne - ${config.fileStorage.storage}`);
			logger.debug(`[${txnId}] Encryption Key - ${encryptionKey}`);

			filePath = sampleFile.path;
			if (encryptionKey) {
				try {
					await commonUtils.encryptFile(sampleFile, encryptionKey);
					filePath += '.enc';
				} catch (err) {
					logger.error(`[${txnId}] Error requesting Security service`, err);
					throw err;
				}
			}

			if (storage === 'GRIDFS') {
				fs.createReadStream(filePath).
					pipe(global.gfsBucket.openUploadStream(crypto.createHash('md5').update(uuid() + global.serverStartTime).digest('hex'), {
						contentType: sampleFile.mimetype,
						metadata: { filename, encrypted: encryptionKey ? true : false }
					})).
					on('error', function (error) {
						logger.error(`[${txnId}] Error uploading file - ${error}`);

						return res.status(500).json({
							message: `Error uploading File - ${error.message}`
						});
					}).
					on('finish', function (file) {
						logger.debug(`[${txnId}] File uploaded to GridFS`);
						logger.trace(`[${txnId}] File details - ${JSON.stringify(file)}`);

						return res.status(200).json(file);
					});

			} else if (storage === 'AZURE') {
				try {
					let file = await createFileObject(req.file, encryptionKey);

					logger.trace(`[${txnId}] File object details - ${JSON.stringify(file)}`);

					let pathFile = JSON.parse(JSON.stringify(file));
					pathFile.path = filePath;

					let data = {};
					data.file = pathFile;
					data.connectionString = config.fileStorage[storage].connectionString;
					data.containerName = config.fileStorage[storage].container;
					data.appName = config.app;
					data.serviceName = config.serviceName;

					await storageEngine.azureBlob.uploadFile(data);

					let resp = await mongoose.model('files').create(file);

					file._id = resp._id;

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
		} finally {
			/****** Removing temp files if exist ******/
			let filesToRemove = [filePath, filePath.split('.enc')[0]];
			filesToRemove.forEach(file => {
				if (fs.existsSync(file)) {
					fs.unlink(file, (err) => {
						if (err) logger.error('Error in deleting file: ' + file, err);
					});
				}
			});
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	});
});

async function downloadFileFromAzure(id, storage, txnId, res, encryptionKey) {
	try {
		let file = await mongoose.model('files').findOne({ filename: id });

		if (!file) {
			logger.error(`[${txnId}] File not found`);
			throw new Error('File Not Found');
		}

		logger.debug(`[${txnId}] File Found, generating download link.`);
		logger.trace(`[${txnId}] File details - ${JSON.stringify(file)}`);

		let data = {};
		data.file = file;
		data.connectionString = config.fileStorage[storage].connectionString;
		data.containerName = config.fileStorage[storage].container;
		data.sharedKey = config.fileStorage[storage].sharedKey;
		data.timeout = config.fileStorage[storage].timeout;
		data.fileName = id;

		if (encryptionKey) {
			let bufferData = await storageEngine.azureBlob.downloadFileBuffer(data);

			res.set('Content-Type', file.contentType);
			res.set('Content-Disposition', 'attachment; filename="' + file.metadata.filename + '"');

			let tmpFilePath = path.join(process.cwd(), 'tmp', id);

			fs.writeFileSync(tmpFilePath, bufferData);

			await commonUtils.decryptFile({ path: tmpFilePath }, encryptionKey);

			let tmpReadStream = fs.createReadStream(tmpFilePath + '.dec');
			tmpReadStream.pipe(res);

			tmpReadStream.on('error', function (err) {
				logger.error(`[${txnId}] Error streaming file - ${err}`);
				return res.end();
			});

		} else {
			let downloadUrl = await storageEngine.azureBlob.downloadFileLink(data);

			logger.debug(`[${txnId}] Redirecting response to Azure download link`);

			return res.redirect(downloadUrl);
		}
	} catch (err) {
		logger.error(`[${txnId}] Error downloading file - ${err.message}`);
		return res.end();
	}
}

// Read a request file object and convert to ds file object format
async function createFileObject(file, encryptionKey) {
	let fileObj = {};
	fileObj.length = file.size;
	fileObj.uploadDate = moment().format('YYYY-MM-DDTHH:mm:ss');
	fileObj.filename = file.filename + '.' + file.originalname.split('.').pop();
	fileObj.contentType = file.mimetype;
	fileObj.metadata = {
		filename: file.originalname,
		encrypted: encryptionKey ? true : false
	};
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
