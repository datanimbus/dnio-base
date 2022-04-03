const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const pprof = require('pprof');

const dataStackUtils = require('@appveen/data.stack-utils');
const { AuthCacheMW } = require('@appveen/ds-auth-cache');
const utils = require('@appveen/utils');

const config = require('./config');
const queueMgmt = require('./queue');

// The average number of bytes between samples.
const intervalBytes = 512 * 1024;
// The maximum stack depth for samples collected.
const stackDepth = 64;
pprof.heap.start(intervalBytes, stackDepth);

const logger = global.logger;

module.exports = async (app) => {
	const upload = multer({ dest: path.join(process.cwd(), 'uploads') });
	const fileValidator = utils.fileValidator;

	logger.debug(`MAX_JSON_SIZE : ${config.MaxJSONSize}`);
	logger.info(`STORAGE_ENGINE : ${config.fileStorage.storage}`);

	app.use(express.json({ limit: config.MaxJSONSize }));
	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());
	app.use(utils.logMiddleware.getLogMiddleware(logger));
	app.use(upload.single('file'));

	let baseURL = `/${config.app}${config.serviceEndpoint}`;
	logger.info(`Base URL : ${baseURL}`);

	let secureFields = require('./api/utils/special-fields.utils').secureFields;
	let masking = [
		{ url: `${baseURL}`, path: secureFields },
		{ url: `${baseURL}/utils/simulate`, path: secureFields },
		{ url: `${baseURL}/{id}`, path: secureFields },
		{ url: `${baseURL}/utils/experienceHook`, path: secureFields }
	];

	app.use(function (req, res, next) {
		if (config.disableInsights) next();
		else {
			const logToQueue = dataStackUtils.logToQueue(`${config.app}.${config.serviceId}`, queueMgmt.client, 'dataService', `${config.app}.${config.serviceId}.logs`, masking, config.serviceId);
			logToQueue(req, res, next);
		}
	});

	app.use(AuthCacheMW({ secret: config.TOKEN_SECRET, decodeOnly: true, app: config.app }));

	app.use(function (req, res, next) {
		let allowedExt = config.allowedExt || [];
		if (!req.file) return next();
		logger.debug(`[${req.get(global.txnIdHeader)}] File upload in request`);
		let flag = true;
		let filename = req.file.originalname;
		logger.debug(`[${req.get(global.txnIdHeader)}] File upload :: filename :: ${filename}`);
		let fileExt = filename.split('.').pop();
		logger.debug(`[${req.get(global.txnIdHeader)}] File upload :: fileExt :: ${fileExt}`);
		if (allowedExt.indexOf(fileExt) == -1) {
			logger.error(`[${req.get(global.txnIdHeader)}] File upload :: fileExt :: Not permitted`);
			flag = false;
		} else {
			flag = fileValidator({ type: 'Buffer', data: fs.readFileSync(req.file.path) }, fileExt);
			logger.info(`[${req.get(global.txnIdHeader)}] Is file ${filename} valid? ${flag}`);
		}
		if (flag) next();
		else next(new Error('File not supported'));
	});

	app.use((req, res, next) => {
		if (req.path.split('/').indexOf('health') == -1) {
			logger.trace(`[${req.get(global.txnIdHeader)}] req.path : ${req.path}`);
			logger.trace(`[${req.get(global.txnIdHeader)}] req.headers : ${JSON.stringify(req.headers)} `);
		}
		global.activeRequest++;
		res.on('close', function () {
			global.activeRequest--;
			if (req.path.split('/').indexOf('live') == -1 && req.path.split('/').indexOf('ready') == -1) {
				logger.debug(`[${req.get(global.txnIdHeader)}] Request completed for ${req.originalUrl}`);
			}
		});
		next();
	});

	app.get('/' + config.app + config.serviceEndpoint + '/utils/tools/pprof', async (req, res) => {
		const profile = await pprof.heap.profile();
		const buf = await pprof.encode(profile);
		res.setHeader('Content-Disposition', `attachment;filename="pprof_${config.serviceId}.pb.gz"`);
		res.write(buf);
		res.status(200).end();
	});

	app.use((err, req, res, next) => {
		if (err) {
			logger.error(`[${req.get(global.txnIdHeader)}] ${err.message}`);
			if (!res.headersSent) {
				logger.error(`[${req.get(global.txnIdHeader)}] Headers sent - ${res.headersSent}`);
				return res.status(500).json({ message: err.message });
			}
		}
		next();
	});
};