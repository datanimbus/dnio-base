const router = require('express').Router();
const mongoose = require('mongoose');

const config = require('../../config');

const logger = global.logger;

router.post('/:id', (req, res) => {
	let txnId = req.get("TxnId")
	async function execute(){
	  try{
	  	let hookId = req.params.id
	  	logger.info(`[${txnId}] Callback :: ${hookId}`)
	  	if(config.disableInsights) {
	  		logger.error(`[${txnId}] Callback :: ${hookId} :: Data service configuration doesn't support callback URLs. Logging of hooks (insights) are disabled.`)
	  		return res.status(400).json({"message": "Data service configuration doesn't support callback URLs"})
	  	}
	  	let data = req.body
	  	
	  	logger.debug(`[${txnId}] Callback :: ${hookId} :: ${JSON.stringify(data)}`)
	  	
	  	if(!data.status) {
	  		logger.error(`[${txnId}] Callback :: ${hookId} :: Missing status field`)
	  		return res.status(400).json({"message": "Missing status field"})
	  	}
	  	if(["Success", "Fail"].indexOf(data.status) == -1) {
	  		logger.error(`[${txnId}] Callback :: ${hookId} :: Not a valid status. It should be either 'Success' or 'Fail'.`)
	  		return res.status(400).json({"message": "Not a valid status. It should be either 'Success' or 'Fail'."})
	  	}

	  	let documentToUpdate = {
	  		status: data.status,
	  		message: data.message || null,
	  		"_metadata.lastUpdated": new Date()
	  	}
	  	
	  	let updateResponse = await global.logsDB.collection(`${config.app}.hook`).findOneAndUpdate({_id: hookId, status: "Requested"}, {$set : documentToUpdate})
	  	logger.trace(`[${txnId}] Callback :: ${hookId} :: Update response :: ${JSON.stringify(updateResponse)}`)
	  	if(updateResponse.value) {
		  	logger.info(`[${txnId}] Callback :: ${hookId} :: Updated`)
				res.end()
	  	} else {
	  		logger.error(`[${txnId}] Callback :: ${hookId} :: Cannot be updated`)
	  		res.status(400).json({message: "Hook cannot be updated."})
	  	}
	  } catch (err) {
	  	if (typeof err === 'string') throw new Error(err)
      throw err;
	  }
	}
	execute().catch(err => {
    logger.error(`[${txnId}] Error in callback :: ${err.message}`)
	  res.status(500).json({message: err.message})
  })
});

module.exports = router;