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
  })
});

router.post('/:fileId/create', (req, res) => {
  let txnId = req.get("TxnId")
  async function execute() {
    const fileId = req.params.fileId;
    const data = req.body;
    const fileName = data.fileName;
    const startTime = Date.now();
    let endTime;
    try {
      let status = await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: { status: 'Importing' } });
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
      status = await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: result });
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
        e = Error(e);
      } else {
        message = e.message;
      }
      await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: { status: 'Error', message } });
      logger.error(`[${txnId}] File mapper :: Creation error :: ${message}`);
      endTime = Date.now();
      throw e;
    } finally {
      logger.info(`[${txnId}] File mapper :: Creation ended :: ${endTime - startTime}ms`);
    }
  }
  execute().catch(err => {
    logger.error(`[${txnId}] File mapper :: Creation error :: ${err.message}`);
    res.status(500).json({ message: err.message });
  })
});

router.put('/:fileId/mapping', (req, res) => {
  let txnId = req.get("TxnId")
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
      status = await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: result });
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
        e = new Error(e);
      } else {
        message = e.message;
      }
      await fileTransfersModel.findOneAndUpdate({ fileId }, { $set: { status: 'Error', message } });
      logger.error(`[${txnId}] File mapper :: Validation error :: ${message}`);
      endTime = Date.now();
      throw e;
    } finally {
      logger.info(`[${txnId}] File mapper :: Validation ended :: ${endTime - startTime}ms`);
    }
  }
  execute().catch(err => {
  	logger.error(err)
    logger.error(`[${txnId}] File mapper :: Validation error :: ${err.message}`);
    res.status(500).json({ message: err.message });
  })
});

router.put('/enrich', (req, res) => {
  async function execute() {
    try {

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
  })
});

module.exports = router;