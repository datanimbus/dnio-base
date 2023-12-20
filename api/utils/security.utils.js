'use strict';

const fs = require('fs');
const path = require('path');
const log4js = require('log4js');
const crypto = require('crypto');
const { Worker } = require('worker_threads');

const logger = log4js.getLogger(global.loggerName);

async function encryptFile(file, encryptionKey) {
	return await executeFileCipher(null, 'encrypt', file, encryptionKey);
}

async function decryptFile(file, encryptionKey) {
	return await executeFileCipher(null, 'decrypt', file, encryptionKey);
}

async function encryptText(data) {
	return await executeCipher(null, 'encrypt', data);
}


async function decryptText(data) {
	return await executeCipher(null, 'decrypt', data);
}

function md5(text) {
	return crypto.createHash('md5').update(text).digest('hex');
}

/**
 * 
 * @param {string} txnId The txnId of the current request
 * @param {string} text The text data to send in thread for encryption/decryption
 */
function executeCipher(txnId, action, text) {
	const appEncryptionKey = global.appEncryptionKey;
	const encryptionKey = global.encryptionKey;
	logger.debug(`[${txnId}] Exec. thread :: cipher`);
	logger.debug(`[${txnId}] App Encryption Key :: ${appEncryptionKey} :: Encryption Key :: ${encryptionKey}`);
	return new Promise((resolve, reject) => {
		let responseSent = false;
		const filePath = path.join(process.cwd(), 'api/threads', 'cipher.js');
		if (!fs.existsSync(filePath)) {
			logger.error(`[${txnId}] Exec. thread :: cipher :: INVALID_FILE`);
			return reject(new Error('INVALID_FILE'));
		}
		const worker = new Worker(filePath, {
			workerData: {
				text,
				appEncryptionKey,
				encryptionKey,
				action
			}
		});
		worker.on('message', function (data) {
			responseSent = true;
			worker.terminate();
			resolve(data);
		});
		worker.on('error', reject);
		worker.on('exit', code => {
			if (!responseSent) {
				logger.error(`[${txnId}] Exec. thread :: cipher :: Worker stopped with exit code ${code}`);
				reject(new Error(`Worker stopped with exit code ${code}`));
			}
		});
	});
}


/**
 * 
 * @param {string} txnId The txnId of the current request
 * @param {string} text The text data to send in thread for encryption/decryption
 */
function executeFileCipher(txnId, action, file, encryptionKey) {
	logger.debug(`[${txnId}] Exec. thread :: file-cipher`);
	return new Promise((resolve, reject) => {
		let responseSent = false;
		const filePath = path.join(process.cwd(), 'api/threads', 'file-cipher.js');
		if (!fs.existsSync(filePath)) {
			logger.error(`[${txnId}] Exec. thread :: file-cipher :: INVALID_FILE`);
			return reject(new Error('INVALID_FILE'));
		}
		const worker = new Worker(filePath, {
			workerData: {
				file,
				encryptionKey,
				action
			}
		});
		worker.on('message', function (data) {
			responseSent = true;
			worker.terminate();
			resolve(data);
		});
		worker.on('error', reject);
		worker.on('exit', code => {
			if (!responseSent) {
				logger.error(`[${txnId}] Exec. thread :: file-cipher :: Worker stopped with exit code ${code}`);
				reject(new Error(`Worker stopped with exit code ${code}`));
			}
		});
	});
}

module.exports.encryptFile = encryptFile;
module.exports.decryptFile = decryptFile;
module.exports.encryptText = encryptText;
module.exports.decryptText = decryptText;
module.exports.md5 = md5;
module.exports.executeCipher = executeCipher;