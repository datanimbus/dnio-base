const router = require('express').Router();
const mongoose = require('mongoose');

const commonUtils = require('../utils/common.utils');
const threadUtils = require('../utils/thread.utils');

const logger = global.logger;
const model = mongoose.model('fileMapper');
const fileTransfersModel = mongoose.model('fileTransfers');

router.get('/:fileId/count', (req, res) => {
	async function execute() {
		try {
			const filter = {};
			filter.fileId = req.params.fileId;
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
			const filter = {};
			filter.fileId = req.params.fileId;
			let docs = await model.find(filter).lean();
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
		const fileId = req.params.fileId;
		const data = req.body;
		const fileName = data.fileName;
		const startTime = Date.now();
		let endTime;
		try {
			await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: { status: 'Importing' } });
			logger.info(`[${txnId}] File mapper :: Creation process :: Started`);
			res.status(202).json({ message: 'Creation Process started...' });

			/**---------- After Response Process ------------*/
			const result = await threadUtils.executeThread(txnId, 'file-mapper-create', {
				req: {
					headers: req.headers
				},
				fileId,
				data
			});
			await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: result });
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
		const fileId = req.params.fileId;
		const data = req.body;
		const fileName = data.fileName;
		const startTime = Date.now();
		let endTime;
		try {
			logger.info(`[${txnId}] File mapper :: Validation process :: Started`);
			res.status(202).json({ message: 'Validation Process Started...' });

			/**---------- After Response Process ------------*/
			const result = await threadUtils.executeThread(txnId, 'file-mapper-validation', {
				req: {
					headers: req.headers
				},
				fileId,
				data
			});
			await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: result });
			endTime = Date.now();
			let socketData = JSON.parse(JSON.stringify(result));
			socketData.fileId = fileId;
			socketData.fileName = fileName;
			socketData.userId = req.headers[global.userHeader];
			logger.debug(`[${txnId}] File mapper :: Validation process :: Socket data :: ${JSON.stringify(socketData)}`);
			commonUtils.informThroughSocket(req, socketData);
		} catch (e) {
			let message;
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

router.put('/:fileId/readStatus', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	let fileId = req.params.fileId;
	// let user = req.headers.user;
	let isRead = req.body.isRead;
	try {
		let doc = await model.findOne({fileId : fileId});
		if (!doc) {
			logger.error(`[${txnId}] File status :: ${fileId} ::  Not found`);
			return res.status(404).json({ message: 'File not found.'});
		}
		logger.debug(`[${txnId}] File status :: ${fileId} :: Found`);
		logger.debug(`[${txnId}] File status :: ${fileId} :: ${JSON.stringify(doc)}`);
		doc.isRead = isRead;
		if(doc._metadata) doc._metadata.lastUpdated = new Date();
		await doc.save();
		logger.info(`[${txnId}] File status :: ${fileId} :: Success`);
		res.json({ message : 'File read status updated successfully.' });
	} catch (err) {
		logger.error(`[${txnId}] File status :: ${fileId} :: ${err.message}`);
		res.status(500).json({ message: err.message});
	}
});

module.exports = router;