const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

let logger = global.logger;

/**
 * 
 * @param {string} file The name of file to be executed in a thread
 * @param {object} data The data to send in thread
 */
function executeThread(_txnId, file, data) {
	logger.debug(`[${_txnId}] Exec. thread :: ${file}`);
	return new Promise((resolve, reject) => {
		const filePath = path.join(process.cwd(), 'api/threads', `${file}.js`);
		if (!fs.existsSync(filePath)) {
			logger.error(`[${_txnId}] Exec. thread :: ${file} :: INVALID_FILE`);
			return reject(new Error('INVALID_FILE'));
		}
		const worker = new Worker(filePath, {
			workerData: data
		});
		worker.on('message', resolve);
		worker.on('error', reject);
		worker.on('exit', code => {
			if (code !== 0)
				logger.error(`[${_txnId}] Exec. thread :: ${file} :: Worker stopped with exit code ${code}`);
			reject(new Error(`Worker stopped with exit code ${code}`));
		});
	});
}

module.exports.executeThread = executeThread;