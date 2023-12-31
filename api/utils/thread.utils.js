const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const log4js = require('log4js');

const logger = log4js.getLogger(global.loggerName);

/**
 * 
 * @param {string} file The name of file to be executed in a thread
 * @param {object} data The data to send in thread
 */
function executeThread(_txnId, file, data) {
	logger.debug(`[${_txnId}] [${data.fileId}] Exec. thread :: ${file}`);
	// Only for filemapper
	if (data.data && data.data.fileName) logger.debug(`[${_txnId}] [${data.fileId}] Exec. thread :: Filename :: ${data.data.fileName}`);

	return new Promise((resolve, reject) => {
		let responseSent = false;
		const filePath = path.join(process.cwd(), 'api/threads', `${file}.js`);
		if (!fs.existsSync(filePath)) {
			logger.error(`[${_txnId}] Exec. thread :: ${file} :: INVALID_FILE`);
			return reject(new Error('INVALID_FILE'));
		}
		data.appEncryptionKey = global.appEncryptionKey;
		data.encryptionKey = global.encryptionKey;
		const worker = new Worker(filePath, {
			workerData: data
		});
		worker.on('message', function (data) {
			responseSent = true;
			worker.terminate();
			resolve(data);
		});
		worker.on('error', reject);
		worker.on('exit', code => {
			if (!responseSent) {
				logger.error(`[${_txnId}] Exec. thread :: ${file} :: Worker stopped with exit code ${code}`);
				reject(new Error(`Worker stopped with exit code ${code}`));
			}
		});
	});
}

module.exports.executeThread = executeThread;