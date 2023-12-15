const router = require('express').Router();
const mongoose = require('mongoose');
const log4js = require('log4js');

const crudderUtils = require('../utils/crudder.utils');

const logger = log4js.getLogger(global.loggerName);
const model = mongoose.model('fileTransfers');

router.get('/count', (req, res) => {
	async function execute() {
		try {
			let filter = {};
			try {
				if (req.query.filter) {
					filter = JSON.parse(req.query.filter);
					filter = crudderUtils.parseFilter(filter);
				}
			} catch (e) {
				logger.error(e);
				return res.status(400).json({
					message: e
				});
			}
			filter.user = req.headers[global.userHeader];
			const count = await model.countDocuments(filter);
			return res.status(200).json(count);
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

router.get('/', (req, res) => {
	async function execute() {
		try {
			let filter = {};
			try {
				if (req.query.filter) {
					filter = JSON.parse(req.query.filter);
					filter = crudderUtils.parseFilter(filter);
				}
			} catch (e) {
				logger.error(e);
				return res.status(400).json({
					message: e
				});
			}
			filter.user = req.headers[global.userHeader];
			if (req.query.countOnly) {
				const count = await model.countDocuments(filter);
				return res.status(200).json(count);
			}
			let skip = 0;
			let count = 30;
			let select = '';
			let sort = '';
			if (req.query.count && (+req.query.count) > 0) {
				count = +req.query.count;
			}
			if (req.query.page && (+req.query.page) > 0) {
				skip = count * ((+req.query.page) - 1);
			}
			if (req.query.select && req.query.select.trim()) {
				select = req.query.select.split(',').join(' ');
			}
			if (req.query.sort && req.query.sort.trim()) {
				sort = req.query.sort.split(',').join(' ');
			}
			const docs = await model.find(filter).select(select).sort(sort).skip(skip).limit(count).lean();
			docs.forEach((doc) => {
				delete doc._metadata?._id;
				delete doc._metadata?.version?._id;
			});
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

router.delete('/:id', (req, res) => {
	async function execute() {
		try {
			let doc = await model.findById(req.params.id);
			if (!doc) {
				return res.status(404).json({
					message: 'Transfer history not found'
				});
			}
			if (doc.user != req.headers[global.userHeader]) {
				return res.status(404).json({
					message: 'Transfer history not found'
				});
			}
			await doc.remove(req);
			res.status(200).json({
				message: 'Transfer history deleted'
			});
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

router.put('/:fileId/readStatus', async (req, res) => {
	let txnId = req.get(global.txnIdHeader);
	let fileId = req.params.fileId;
	// let user = req.headers.user;
	let isRead = req.body.isRead;
	try {
		let doc = await model.findById(fileId);
		if (!doc) {
			logger.error(`[${txnId}] File status :: ${fileId} ::  Not found`);
			return res.status(404).json({ message: 'File not found.' });
		}
		logger.debug(`[${txnId}] File status :: ${fileId} :: Found`);
		logger.trace(`[${txnId}] File status :: ${fileId} :: ${JSON.stringify(doc)}`);
		doc.isRead = isRead;
		if (doc._metadata) doc._metadata.lastUpdated = new Date();
		await doc.save();
		logger.info(`[${txnId}] File status :: ${fileId} :: Success`);
		res.json({ message: 'File read status updated successfully.' });
	} catch (err) {
		logger.error(`[${txnId}] File status :: ${fileId} :: ${err.message}`);
		res.status(500).json({ message: err.message });
	}
});

module.exports = router;