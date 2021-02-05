const fs = require('fs');
const path = require('path');

const mongoose = require('mongoose');

const config = require('../../config');
const httpClient = require('../../http-client');
const queueMgmt = require('../../queue');

const logger = global.logger;

const client = queueMgmt.client;

client.on('connect', () => {
	getRoles()
	processRolesQueue()
})

client.on('reconnect', () => {
	getRoles()
	processRolesQueue()
})

async function getRoles() {
	logger.trace(`Get roles`);
  try {
		let authorDB = mongoose.connections[1].client.db(config.authorDB)
		authorDB.collection('userMgmt.roles').findOne({_id: config.serviceId})
		.then(_d => {
			if(!_d) {
	      logger.error(`Get roles :: Unable to find ${config.serviceId}`);
	      return;
			}
	    logger.trace(`Get roles :: data :: ${JSON.stringify(_d)}`)
	  	setRoles(_d);
		})
  } catch (err) {
    logger.error(`Get roles :: ${err.message}`);
  }
}

/**
 * 
 * @param {*} role The Complete Role Data stored in the DB.
 */
function setRoles(role) {
    if (role && typeof role === 'object') {
        fs.writeFileSync(path.join(process.cwd(), 'role.json'), JSON.stringify(role), 'utf-8');
    }
}

// Roles quque
function processRolesQueue() {
	// check if this is running inside a worker
	if (global.doNotSubscribe) return
	logger.info(`Starting subscription to roles channel`)
  try {
    var opts = client.subscriptionOptions();
    opts.setStartWithLastReceived();
    opts.setDurableName(config.serviceId + '-role-durable');
    var subscription = client.subscribe(config.serviceId + '-role', config.serviceId + '-role', opts);
    subscription.on('message', function (_body) {
      try {
        let bodyObj = JSON.parse(_body.getData());
        logger.debug(`Message from roles channel :: ${config.serviceId}-role :: ${JSON.stringify(bodyObj)}`);
        setRoles(bodyObj);
      } catch (err) {
        logger.error(`Error processing roles queue :: ${err.message}`);
      }
    });
  } catch (err) {
    logger.error(`Roles channel :: ${err.message}`);
  }
}

module.exports.getRoles = getRoles;
module.exports.setRoles = setRoles;

