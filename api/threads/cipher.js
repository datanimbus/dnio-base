const { workerData, parentPort } = require('worker_threads');
const crypto = require('crypto');

const IV_LENGTH = 16;
const action = workerData.action;
const text = workerData.text;
const encryptionKey = workerData.encryptionKey;
const baseKey = workerData.baseKey;
const baseCert = workerData.baseCert;
const SECRET = '34857057658800771270426551038148';

let resultData;
try {
	switch (action) {
	case 'encrypt': {
		const cert = decrypt(baseCert, encryptionKey);
		resultData = encryptUsingPublicKey(text, cert);
		break;
	}
	case 'decrypt': {
		const key = decrypt(baseKey, encryptionKey);
		resultData = decryptUsingPrivateKey(text, key);
		break;
	}
	}
	parentPort.postMessage({ statusCode: 200, body: { data: resultData } });
} catch (err) {
	parentPort.postMessage({ statusCode: 500, body: err });
}

function encryptUsingPublicKey(text, key) {
	let iv = crypto.randomBytes(IV_LENGTH);
	let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(SECRET), iv);
	let encrypted = cipher.update(text);
	encrypted = Buffer.concat([encrypted, cipher.final()]);
	let basepub = Buffer.from(key);
	let initializationVector = crypto.publicEncrypt(basepub, iv);
	return initializationVector.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptUsingPrivateKey(text, key) {
	let textParts = text.split(':');
	let initializationVector = Buffer.from(textParts.shift(), 'hex');
	let iv = crypto.privateDecrypt(key, initializationVector);
	let encryptedText = Buffer.from(textParts.join(':'), 'hex');
	let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(SECRET), iv);
	let decrypted = decipher.update(encryptedText);
	decrypted = Buffer.concat([decrypted, decipher.final()]);
	return decrypted.toString();
}

// function encrypt(plainText, secret) {
// 	const key = crypto.createHash('sha256').update(secret).digest('base64').substring(0, 32);
// 	const iv = crypto.randomBytes(IV_LENGTH);
// 	const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
// 	let cipherText;
// 	try {
// 		cipherText = cipher.update(plainText, 'utf8', 'hex');
// 		cipherText += cipher.final('hex');
// 		cipherText = iv.toString('hex') + ':' + cipherText;
// 	} catch (e) {
// 		cipherText = null;
// 	}
// 	return cipherText;
// }


function decrypt(cipherText, secret) {
	const key = crypto.createHash('sha256').update(secret).digest('base64').substring(0, 32);
	const iv = Buffer.from(cipherText.split(':')[0], 'hex');
	const textBytes = cipherText.split(':')[1];
	const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
	let decrypted = decipher.update(textBytes, 'hex', 'utf8');
	decrypted += decipher.final('utf8');
	return decrypted;
}