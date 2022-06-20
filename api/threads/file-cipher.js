const { workerData, parentPort } = require('worker_threads');
const crypto = require('crypto');
const fs = require('fs');

const IV_LENGTH = 16;
const action = workerData.action;
const file = workerData.file;
const encryptionKey = workerData.encryptionKey;

(async () => {
	try {
		if (!fs.existsSync(file.path)) {
			throw new Error('INVALID_FILE');
		}
		let resultData;
		switch (action) {
			case 'encrypt': {
				await encryptFile(file, encryptionKey);
				resultData = 'File Encrypted';

				break;
			}
			case 'decrypt': {
				await decryptFile(file, encryptionKey);
				resultData = 'File Decrypted';

				break;
			}
		}
		parentPort.postMessage({ statusCode: 200, body: { message: resultData } });
	} catch (err) {
		parentPort.postMessage({ statusCode: 500, body: err });
	}
})();

// function encrypt(plainText, secret) {
// 	const key = crypto.createHash('sha256').update(secret).digest('base64').substring(0, 32);
// 	const iv = crypto.randomBytes(IV_LENGTH);
// 	const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
// 	let cipherText;
// 	try {
// 		cipherText = cipher.update(plainText, 'binary', 'hex');
// 		cipherText += cipher.final('hex');
// 		cipherText = iv.toString('hex') + ':' + cipherText;
// 	} catch (e) {
// 		cipherText = null;
// 	}
// 	return cipherText;
// }


// function decrypt(cipherText, secret) {
// 	const key = crypto.createHash('sha256').update(secret).digest('base64').substring(0, 32);
// 	const iv = Buffer.from(cipherText.split(':')[0], 'hex');
// 	const textBytes = cipherText.split(':')[1];
// 	const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
// 	let decrypted = decipher.update(textBytes, 'hex', 'binary');
// 	decrypted += decipher.final('binary');
// 	return decrypted;
// }


function encryptFile(file, key) {
	return new Promise(async (resolve, reject) => {
		const digestHash = crypto.createHash('sha256').update(key).digest('hex');
		const allocatedKey = Buffer.alloc(32, digestHash);
		const iv = crypto.randomBytes(IV_LENGTH);
		const rStream = fs.createReadStream(file.path);
		const wStream = fs.createWriteStream(file.path + '.enc');
		const cipher = crypto.createCipheriv('aes-256-cbc', allocatedKey, iv);
		wStream.write(iv);
		wStream.on('close', function () {
			resolve();
		});
		rStream.on('error', function (err) {
			reject(err);
		});
		wStream.on('error', function (err) {
			reject(err);
		});
		rStream.pipe(cipher).pipe(wStream);
	});
}


function decryptFile(file, key) {
	return new Promise(async (resolve, reject) => {
		const digestHash = crypto.createHash('sha256').update(key).digest('hex');
		const allocatedKey = Buffer.alloc(32, digestHash);
		const iv = await getIvFromStream(file.path);
		const rStream = fs.createReadStream(file.path, { start: IV_LENGTH });
		const wStream = fs.createWriteStream(file.path + '.dec');
		const cipher = crypto.createDecipheriv('aes-256-cbc', allocatedKey, iv);
		wStream.on('close', function () {
			resolve();
		});
		rStream.on('error', function (err) {
			reject(err);
		});
		wStream.on('error', function (err) {
			reject(err);
		});
		rStream.pipe(cipher).pipe(wStream);
	});
}

async function getIvFromStream(inputPath) {
	return new Promise((resolve) => {
		let iv;
		fs.createReadStream(inputPath, { start: 0, end: IV_LENGTH - 1 })
			.on('data', (persistedIv) => (iv = persistedIv))
			.on('close', () => resolve(iv));
	});
}
