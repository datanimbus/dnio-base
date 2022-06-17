const { workerData, parentPort } = require('worker_threads');
const crypto = require('crypto');
const fs = require('fs');

const IV_LENGTH = 16;
const action = workerData.action;
const file = workerData.file;
const encryptionKey = workerData.encryptionKey;

let resultData;
try {
	if (!fs.existsSync(file.path)) {
		throw new Error('INVALID_FILE');
	}
	let fileData = fs.readFileSync(file.path);

	switch (action) {
	case 'encrypt': {
        resultData = encrypt(fileData, encryptionKey);
        break;
	}
	case 'decrypt': {
		resultData = decrypt(fileData, encryptionKey);
		break;
	}
	}

	fs.writeFileSync(file.path, resultData);

	parentPort.postMessage({ statusCode: 200, body: { data: resultData } });
} catch (err) {
	parentPort.postMessage({ statusCode: 500, body: err });
}

function encrypt(plainText, secret) {
	const key = crypto.createHash('sha256').update(secret).digest('base64').substring(0, 32);
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
	let cipherText;
	try {
		cipherText = cipher.update(plainText, 'utf8', 'hex');
		cipherText += cipher.final('hex');
		cipherText = iv.toString('hex') + ':' + cipherText;
	} catch (e) {
		cipherText = null;
	}
	return cipherText;
}


function decrypt(cipherText, secret) {
	const key = crypto.createHash('sha256').update(secret).digest('base64').substring(0, 32);
	const iv = Buffer.from(cipherText.split(':')[0], 'hex');
	const textBytes = cipherText.split(':')[1];
	const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
	let decrypted = decipher.update(textBytes, 'hex', 'utf8');
	decrypted += decipher.final('utf8');
	return decrypted;
}
