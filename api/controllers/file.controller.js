const router = require('express').Router();
const uuid = require('uuid/v1');
const log4js = require('log4js');
const mongoose = require('mongoose');
const moment = require('moment');
const commonUtils = require('../utils/common.utils');
const storageEngine = require('@appveen/data.stack-utils').storageEngine;
const Mustache = require('mustache');
const specialFields = require('../utils/special-fields.utils');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('../../config');

const logger = log4js.getLogger(global.loggerName);

router.get('/:id/view', (req, res) => {
	async function execute() {
		try {
			const id = req.params.id;
			const storage = config.fileStorage.type;
			let txnId = req.get('txnid');

			logger.debug(`[${txnId}] File view request received for id ${id}`);
			logger.debug(`[${txnId}] Storage Enigne - ${storage}`);

			// if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
			// 	return res.status(403).json({
			// 		message: 'You don\'t have permission to fetch file',
			// 	});
			// }

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
			} else if (storage === 'AZBLOB') {
				return await downloadFileFromAzure(id, txnId, res);
			} else if (storage === 'S3') {
				return await downloadFileFromS3(id, txnId, res);
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
		// if (!specialFields.hasPermissionForGET(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
		// 	return res.status(403).json({
		// 		message: 'You don\'t have permission to fetch file',
		// 	});
		// }

		let tmpDirPath, id;
		try {
			id = req.params.id;
			const storage = config.connectors.file.type;
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
						renderError(res, 500, err.message || 'Error on reading file', { fqdn: config.fqdn });
					});

					writeStream.on('error', function (err) {
						logger.error(`[${txnId}] Error streaming file - ${err}`);
						renderError(res, 500, err.message || 'Error on reading file', { fqdn: config.fqdn });
					});

					writeStream.on('close', async function () {

						let downloadFilePath = tmpFilePath;
						try {
							await commonUtils.decryptFile({ path: tmpFilePath }, encryptionKey);
							downloadFilePath += '.dec';
						} catch (err) {
							logger.error(err);
							if (err.code == 'ERR_OSSL_EVP_BAD_DECRYPT') {
								return renderError(res, 400, "Bad Decryption Key", { fqdn: config.fqdn });
							} else {
								return renderError(res, 500, err.message, { fqdn: config.fqdn });
							}
						}

						res.set('Content-Type', file.contentType);
						res.set('Content-Disposition', 'attachment; filename="' + file.metadata.filename + '"');

						let tmpReadStream = fs.createReadStream(downloadFilePath);
						tmpReadStream.on('error', function (err) {
							logger.error(`[${txnId}] Error streaming file - ${err}`);
							renderError(res, 500, err.message || 'Error on reading file', { fqdn: config.fqdn });
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
			} else if (storage === 'AZBLOB') {
				return await downloadFileFromAzure(id, txnId, res, encryptionKey);
			} else if (storage === 'S3') {
				return await downloadFileFromS3(id, txnId, res, encryptionKey);
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
			setTimeout(() => {
				/****** Removing temp files if exist ******/
				let filesToRemove = [path.join(tmpDirPath, id), path.join(tmpDirPath, id + '.dec')];
				filesToRemove.forEach(file => {
					if (fs.existsSync(file)) {
						fs.unlink(file, (err) => {
							if (err) logger.error('Error in deleting file: ' + file, err);
						});
					}
				});
			}, 5000);
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	});
});

function renderError(res, statusCode, message, options) {
	const doc = fs.readFileSync(path.join(process.cwd(), 'views', 'error.mustache'), 'utf-8');
	const output = Mustache.render(doc, { statusCode, message, ...options });
	res.end(output);
}

router.post('/upload', (req, res) => {
	async function execute() {
		let filePath;
		try {
			const storage = config.connectors.file.type;
			let txnId = req.get('txnid');
			const sampleFile = req.file;
			const filename = sampleFile.originalname;
			const encryptionKey = req.query.encryptionKey;

			logger.debug(`[${txnId}] File upload request received - ${filename}`);
			logger.debug(`[${txnId}] Storage Enigne - ${storage}`);
			logger.debug(`[${txnId}] Encryption Key - ${encryptionKey}`);

			if (!specialFields.hasPermissionForPOST(req, (req.user && req.user.appPermissions ? req.user.appPermissions : []))) {
				logger.error(`[${txnId}] User does not have permission to create records ${(req.user && req.user.appPermissions ? req.user.appPermissions : [])}`);
				return res.status(403).json({
					message: 'You don\'t have permission to upload files',
				});
			}

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

			} else if (storage === 'AZBLOB') {
				try {
					let file = await createFileObject(req.file, encryptionKey);

					logger.trace(`[${txnId}] File object details - ${JSON.stringify(file)}`);

					let pathFile = JSON.parse(JSON.stringify(file));
					pathFile.path = filePath;
					pathFile.filename = pathFile.blobName;

					let data = {};
					data.file = pathFile;
					data.connectionString = config.connectors.file.AZURE.connectionString;
					data.containerName = config.connectors.file.AZURE.container;
					data.appName = config.app;
					data.serviceName = config.serviceName;

					await storageEngine.azureBlob.uploadFile(data);

					let resp = await mongoose.model('files').create(file);

					file._id = resp._id;

					logger.trace(`[${txnId}] File details - ${JSON.stringify(file)}`);

					return res.status(200).json(file);
				} catch (error) {
					logger.error(`[${txnId}] Error while upploading file to Azure Blob :: ${error}`);

					return res.status(500).json({
						message: `Error uploading file :: ${error.message}`
					});
				}
			} else if (storage === 'S3') {
				try {
					let file = await createFileObject(req.file, encryptionKey);

					logger.trace(`[${txnId}] S3 file object details :: ${JSON.stringify(file)}`);

					let pathFile = JSON.parse(JSON.stringify(file));
					pathFile.path = filePath;
					pathFile.fileName = pathFile.blobName;

					let data = {};
					data.file = pathFile;
					data.accessKeyId = config.connectors.file.S3.accessKeyId;
					data.secretAccessKey = config.connectors.file.S3.secretAccessKey;
					data.region = config.connectors.file.S3.region;
					data.bucket = config.connectors.file.S3.bucket;
					data.appName = config.app;
					data.serviceId = config.serviceId;
					data.serviceName = config.serviceName;

					await storageEngine.S3.uploadFile(data);

					let resp = await mongoose.model('files').create(file);

					file._id = resp._id;

					logger.trace(`[${txnId}] File details - ${JSON.stringify(file)}`);

					return res.status(200).json(file);
				} catch (error) {
					logger.error(`[${txnId}] Error while uploading file to S3 :: ${error}`);

					return res.status(500).json({
						message: `Error uploading file :: ${error.message}`
					});
				}
			} else if (storage === 'GCS') {
				try {
					let file = await createFileObject(req.file, encryptionKey);

					logger.trace(`[${txnId}] GCS file object details :: ${JSON.stringify(file)}`);

					let pathFile = JSON.parse(JSON.stringify(file));
					pathFile.path = filePath;
					pathFile.fileName = pathFile.blobName;

					let gcsConfigFilePath = path.join(process.cwd(), 'gcs.json');

					let data = {};
					data.file = pathFile;
					data.appName = config.app;
					data.serviceId = config.serviceId;
					data.serviceName = config.serviceName;
					data.gcsConfigFilePath = gcsConfigFilePath;
					data.bucket = config.connectors.file.GCS.bucket;
					data.projectId =  config.connectors.file.GCS.projectId;


					await storageEngine.GCS.uploadFile(data);

					let resp = await mongoose.model('files').create(file);

					file._id = resp._id;

					logger.trace(`[${txnId}] File details - ${JSON.stringify(file)}`);

					return res.status(200).json(file);
				} catch (error) {
					logger.error(`[${txnId}] Error while uploading file to GCS :: ${error}`);

					return res.status(500).json({
						message: `Error uploading file :: ${error.message}`
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
			setTimeout(() => {
				/****** Removing temp files if exist ******/
				let filesToRemove = [filePath, filePath.split('.enc')[0]];
				filesToRemove.forEach(file => {
					if (fs.existsSync(file)) {
						fs.unlink(file, (err) => {
							if (err) logger.error('Error in deleting file: ' + file, err);
						});
					}
				});
			}, 5000);
		}
	}
	execute().catch(err => {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	});
});

async function downloadFileFromAzure(id, txnId, res, encryptionKey) {
	try {
		let file = await mongoose.model('files').findOne({ filename: id });

		if (!file) {
			logger.error(`[${txnId}] File not found`);
			throw new Error('File Not Found');
		}

		logger.debug(`[${txnId}] File Found, generating download link.`);
		logger.trace(`[${txnId}] File details - ${JSON.stringify(file)}`);

		file.filename = `${config.app}/${config.serviceId}_${config.serviceName}/${id}`;
		let data = {};
		data.file = file;
		data.connectionString = config.connectors.file.AZURE.connectionString;
		data.containerName = config.connectors.file.AZURE.container;
		data.sharedKey = config.connectors.file.AZURE.sharedKey;
		data.timeout = config.connectors.file.AZURE.timeout;
		data.fileName = id;

		if (encryptionKey) {
			let bufferData = await storageEngine.azureBlob.downloadFileBuffer(data);

			let tmpFilePath = path.join(process.cwd(), 'tmp', id);

			fs.writeFileSync(tmpFilePath, bufferData);

			let downloadFilePath = tmpFilePath;
			try {
				await commonUtils.decryptFile({ path: tmpFilePath }, encryptionKey);
				downloadFilePath += '.dec';
			} catch (err) {
				logger.error(err);
				if (err.code == 'ERR_OSSL_EVP_BAD_DECRYPT') {
					return renderError(res, 400, "Bad Decryption Key", { fqdn: config.fqdn });
				} else {
					return renderError(res, 500, err.message, { fqdn: config.fqdn });
				}
			}

			res.set('Content-Type', file.contentType);
			res.set('Content-Disposition', 'attachment; filename="' + file.metadata.filename + '"');

			let tmpReadStream = fs.createReadStream(downloadFilePath);
			tmpReadStream.pipe(res);

			tmpReadStream.on('error', function (err) {
				logger.error(`[${txnId}] Error streaming file - ${err}`);
				renderError(res, 500, err.message || 'Error on reading file');
			});

		} else {
			let downloadUrl = await storageEngine.azureBlob.downloadFileLink(data);

			logger.debug(`[${txnId}] Redirecting response to Azure download link`);

			return res.redirect(downloadUrl);
		}
	} catch (err) {
		logger.error(`[${txnId}] Error downloading file - ${err.message}`);
		throw err;
	}
}


async function downloadFileFromS3(id, txnId, res, encryptionKey) {
	try {
		let file = await mongoose.model('files').findOne({ filename: id });

		if (!file) {
			logger.error(`[${txnId}] File not found`);
			throw new Error('File Not Found');
		}

		logger.debug(`[${txnId}] File Found, download from S3.`);
		logger.trace(`[${txnId}] File details - ${JSON.stringify(file)}`);

		let data = {};
		data.accessKeyId = config.connectors.file.S3.accessKeyId;
		data.secretAccessKey = config.connectors.file.S3.secretAccessKey;
		data.region = config.connectors.file.S3.region;
		data.bucket = config.connectors.file.S3.bucket;
		data.fileName = `${config.app}/${config.serviceId}_${config.serviceName}/${id}`;

		let bufferData = await storageEngine.S3.downloadFileBuffer(data);

		let tmpFilePath = path.join(process.cwd(), 'tmp', id);

		fs.writeFileSync(tmpFilePath, bufferData);

		let downloadFilePath = tmpFilePath;

		if (encryptionKey) {
			try {
				await commonUtils.decryptFile({ path: tmpFilePath }, encryptionKey);
				downloadFilePath += '.dec';
			} catch (err) {
				logger.error(err);
				if (err.code == 'ERR_OSSL_EVP_BAD_DECRYPT') {
					return renderError(res, 400, "Bad Decryption Key", { fqdn: config.fqdn });
				} else {
					return renderError(res, 500, err.message, { fqdn: config.fqdn });
				}
			}
		}
		res.set('Content-Type', file.contentType);
		res.set('Content-Disposition', 'attachment; filename="' + file.metadata.filename + '"');

		let tmpReadStream = fs.createReadStream(downloadFilePath);
		tmpReadStream.pipe(res);

		tmpReadStream.on('error', function (err) {
			logger.error(`[${txnId}] Error streaming file - ${err}`);
			renderError(res, 500, err.message || 'Error on reading file');
		});
	} catch (err) {
		logger.error(`[${txnId}] Error downloading file - ${err.message}`);
		throw err;
	}
}

// Read a request file object and convert to ds file object format
async function createFileObject(file, encryptionKey) {
	let fileObj = {};
	fileObj.length = file.size;
	fileObj.uploadDate = moment().format('YYYY-MM-DDTHH:mm:ss');
	fileObj.blobName = `${config.app}/${config.serviceId}_${config.serviceName}/${file.filename}.${file.originalname.split('.').pop()}`;
	fileObj.filename = `${file.filename}.${file.originalname.split('.').pop()}`;
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
