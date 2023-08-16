const router = require('express').Router();
const mongoose = require('mongoose');
const log4js = require('log4js');

const commonUtils = require('../utils/common.utils');
const threadUtils = require('../utils/thread.utils');
const crudderUtils = require('../utils/crudder.utils');
const specialFields = require('../utils/special-fields.utils');
const serviceDetails = require('../../service.json');

const logger = log4js.getLogger(global.loggerName);
const model = mongoose.model('fileMapper');
const fileTransfersModel = mongoose.model('fileTransfers');

router.get('/:fileId/count', (req, res) => {
	async function execute() {
		try {
			let filter = req.query.filter;
			if (!filter) {
				filter = {};
			}
			if (typeof filter === 'string') {
				filter = JSON.parse(filter);
			}
			filter.fileId = req.params.fileId;
			filter = crudderUtils.parseFilter(filter);
			const count = await model.countDocuments(filter);
			res.status(200).json(count);
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

router.get('/:fileId', (req, res) => {
	async function execute() {
		try {
			let filter = req.query.filter;
			if (!filter) {
				filter = {};
			}
			if (typeof filter === 'string') {
				filter = JSON.parse(filter);
			}
			filter.fileId = req.params.fileId;
			filter = crudderUtils.parseFilter(filter);
			let docs = await model.find(filter).lean();
			if (specialFields.secureFields && specialFields.secureFields.length && specialFields.secureFields[0]) {
				let promises = docs.map(e => specialFields.decryptSecureFields(req, e.data, null));
				await Promise.all(promises);
				promises = null;
			}
			res.status(200).json(docs);
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

router.post('/:fileId/create', (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	async function execute() {
		const data = JSON.parse(JSON.stringify(req.body));
		const fileId = data.fileId;
		const fileName = data.fileName;
		const startTime = Date.now();
		let endTime;
		try {

			if (fileId !== req.params.fileId) {
				return res.status(400).json({ message: 'FileId in Url and body does not match.' });
			}
			let fileTransferDocumentId = await fileTransfersModel.collection.findOne({ fileId: fileId });

			if (!fileTransferDocumentId) {
				return res.status(404).json({ message: 'File not found.' });
			}
			fileTransferDocumentId = fileTransferDocumentId?._id;

			await fileTransfersModel.findOneAndUpdate({ _id: fileTransferDocumentId }, { $set: { status: 'Importing' } });
			logger.info(`[${txnId}] File mapper :: Creation process :: Started`);
			res.status(202).json({ message: 'Creation Process started...' });

			/**---------- After Response Process ------------*/
			const result = await threadUtils.executeThread(txnId, 'file-mapper-create', {
				req: {
					headers: req.headers,
					user: req.user,
					rawHeaders: req.rawHeaders
				},
				fileId,
				data,
				schemaFree: serviceDetails.schemaFree ? true : false
			});
			await fileTransfersModel.findOneAndUpdate({ _id: fileTransferDocumentId }, { $set: result });
			endTime = Date.now();
			let socketData = JSON.parse(JSON.stringify(result));
			socketData.fileId = fileId;
			socketData.userId = req.headers[global.userHeader];
			socketData.fileName = fileName;
			logger.debug(`[${txnId}] File mapper :: Creation process :: Socket data :: ${JSON.stringify(socketData)}`);
			commonUtils.informThroughSocket(req, socketData);
		} catch (e) {
			let message;
			if (typeof e === 'string') {
				message = e;
			} else {
				message = e.message;
			}
			await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: { status: 'Error', message } });
			logger.error(`[${txnId}] File mapper :: Creation error :: ${message}`);
			endTime = Date.now();
			throw new Error(message);
		} finally {
			logger.info(`[${txnId}] File mapper :: Creation ended :: ${endTime - startTime}ms`);
		}
	}
	execute().catch(err => {
		logger.error(`[${txnId}] File mapper :: Creation error :: ${err.message}`);
		res.status(500).json({ message: err.message });
	});
});

router.put('/:fileId/mapping', (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	async function execute() {
		const data = JSON.parse(JSON.stringify(req.body));
		const fileId = data.fileId;
		const fileName = data.fileName;
		const startTime = Date.now();
		let endTime;

		if (req.params.fileId !== fileId) {
			return res.status(400).json({ message: 'FileId in Url and body does not match.' });
		}

		let headerMapping = data.headerMapping;
		let atleastOneMappingPresent = Object.keys(headerMapping).filter(key => headerMapping[key] != null).length > 0;
		logger.debug(`[${txnId}] [${fileId}] File mapper ::  At least one mapping present :: ${atleastOneMappingPresent}`);
		if (!atleastOneMappingPresent && !serviceDetails.schemaFree) throw Error('At least one field must be mapped');

		try {
			let fileTransferDocument = await mongoose.model('fileTransfers').collection.findOne({ fileId: fileId });
			if (!fileTransferDocument) {
				endTime = Date.now();
				return res.status(404).json({ message: 'File not found.' });
			}

			logger.info(`[${txnId}] [${fileId}] File mapper :: Validation process :: Started`);
			logger.debug(`[${txnId}] [${fileId}] File mapper :: File name :: ${fileName}`);
			res.status(202).json({ message: 'Validation Process Started...' });

			/**---------- After Response Process ------------*/
			let result;
			let threadName = 'file-mapper-validation';
			if (serviceDetails.schemaFree) {
				threadName = 'schemafree-file-mapper-validation';
			}
			result = await threadUtils.executeThread(txnId, threadName, {
				req: {
					headers: req.headers,
					user: req.user,
					rawHeaders: req.rawHeaders
				},
				fileId,
				data
			});

			endTime = Date.now();
			let socketData = JSON.parse(JSON.stringify(result));
			socketData.fileId = fileId;
			socketData.fileName = fileName;
			socketData.userId = req.headers[global.userHeader];
			logger.debug(`[${txnId}] File mapper :: Validation process :: Socket data :: ${JSON.stringify(socketData)}`);
			commonUtils.informThroughSocket(req, socketData);
		} catch (e) {
			let message;
			console.log(e);
			if (typeof e === 'string') {
				message = e;
			} else {
				message = e.message;
			}
			await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: { status: 'Error', message } });
			logger.error(`[${txnId}] File mapper :: Validation error :: ${message}`);
			endTime = Date.now();
			throw new Error(message);
		} finally {
			logger.info(`[${txnId}] File mapper :: Validation ended :: ${endTime - startTime}ms`);
		}
	}
	execute().catch(err => {
		logger.error(err);
		logger.error(`[${txnId}] File mapper :: Validation error :: ${err.message}`);
		res.status(500).json({ message: err.message });
	});
});

// router.put('/enrich', (req, res) => {
// 	async function execute() {
// 		try {
// 			// missing block
// 		} catch (e) {
// 			if (typeof e === 'string') {
// 				throw new Error(e);
// 			}
// 			throw e;
// 		}
// 	}
// 	execute().catch(err => {
// 		logger.error(err);
// 		res.status(500).json({
// 			message: err.message
// 		});
// 	});
// });

module.exports = router;
