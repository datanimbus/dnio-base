const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');


/**
 * 
 * @param {string} file The name of file to be executed in a thread
 * @param {object} data The data to send in thread
 */
function executeThread(file, data) {
	return new Promise((resolve, reject) => {
		const filePath = path.join(process.cwd(), 'api/threads', file + '.js');
		if (!fs.existsSync(filePath)) {
			return reject(new Error('INVALID_FILE'));
		}
		const worker = new Worker(filePath, {
			workerData: data
		});
		worker.on('message', resolve);
		worker.on('error', reject);
		worker.on('exit', code => {
			if (code !== 0)
				reject(new Error(`Worker stopped with exit code ${code}`));
		});
	});
}

module.exports.executeThread = executeThread;