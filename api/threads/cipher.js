const { workerData, parentPort } = require('worker_threads');
const crypto = require('crypto');
const log4js = require('log4js');

const IV_LENGTH = 16;
const action = workerData.action;
const text = workerData.text;
const encryptionKey = workerData.encryptionKey;
const appEncryptionKey = workerData.appEncryptionKey;
// const SECRET = '34857057658800771270426551038148';

const config = require('../../config');

let additionalLoggerIdentifier = 'Worker/Cipher';

config.appNamespace = process.env.DATA_STACK_APP_NS;

let LOGGER_NAME = config.isK8sEnv() ? `[${config.appNamespace}] [${config.hostname}] [${config.serviceId}] [${additionalLoggerIdentifier}]` : `[${config.serviceId}][${additionalLoggerIdentifier}]`;
global.loggerName = LOGGER_NAME;

const LOG_LEVEL = process.env.LOG_LEVEL ? process.env.LOG_LEVEL : 'info';
global.LOG_LEVEL = LOG_LEVEL;

log4js.configure({
	appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
	categories: { default: { appenders: ['out'], level: LOG_LEVEL } }
});
let logger = log4js.getLogger(LOGGER_NAME);

let resultData;
try {
	switch (action) {
	case 'encrypt': {
		const cert = decrypt(appEncryptionKey, encryptionKey);
		resultData = encrypt(text, cert);
		break;
	}
	case 'decrypt': {
		const key = decrypt(appEncryptionKey, encryptionKey);
		resultData = decrypt(text, key);
		break;
	}
	}
	logger.trace('Result data in thread :: ', resultData);
	parentPort.postMessage({ statusCode: 200, body: { data: resultData } });
} catch (err) {
	parentPort.postMessage({ statusCode: 500, body: err });
}

// function encryptUsingPublicKey(text, key) {
// 	let iv = crypto.randomBytes(IV_LENGTH);
// 	let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(SECRET), iv);
// 	let encrypted = cipher.update(text);
// 	encrypted = Buffer.concat([encrypted, cipher.final()]);
// 	let basepub = Buffer.from(key);
// 	let initializationVector = crypto.publicEncrypt(basepub, iv);
// 	return initializationVector.toString('hex') + ':' + encrypted.toString('hex');
// }

// function decryptUsingPrivateKey(text, key) {
// 	let textParts = text.split(':');
// 	let initializationVector = Buffer.from(textParts.shift(), 'hex');
// 	let iv = crypto.privateDecrypt(key, initializationVector);
// 	let encryptedText = Buffer.from(textParts.join(':'), 'hex');
// 	let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(SECRET), iv);
// 	let decrypted = decipher.update(encryptedText);
// 	decrypted = Buffer.concat([decrypted, decipher.final()]);
// 	return decrypted.toString();
// }

function encrypt(plainText, secret) {
	logger.trace('Encrypting plain text :: ', plainText);
	logger.trace('Encryption secret :: ', secret);
	let cipherText;
	try {
		const key = crypto.createHash('sha256').update(secret).digest('base64').substring(0, 32);
		const iv = crypto.randomBytes(IV_LENGTH);
		logger.trace('Encrypting key and iv :: ', key, iv);
		const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
		logger.trace('Encryption cipher :: ', cipher);

		cipherText = cipher.update(plainText, 'utf8', 'hex');
		cipherText += cipher.final('hex');
		cipherText = iv.toString('hex') + ':' + cipherText;
	} catch (e) {
		logger.error('Error encrypting text :: ', e);
		cipherText = null;
	}
	logger.trace('Encrypted Cipher Text :: ', cipherText);
	return cipherText;
}


function decrypt(cipherText, secret) {
	let decrypted;
	try {
		const key = crypto.createHash('sha256').update(secret).digest('base64').substring(0, 32);
		const iv = Buffer.from(cipherText.split(':')[0], 'hex');
		const textBytes = cipherText.split(':')[1];
		const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
		decrypted = decipher.update(textBytes, 'hex', 'utf8');
		decrypted += decipher.final('utf8');
	} catch (err) {
		logger.error('Error decrypting text :: ', err);
	}
	return decrypted;
}