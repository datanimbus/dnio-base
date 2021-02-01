const fs = require('fs');
const path = require('path');

const mongoose = require('mongoose');

const config = require('../../config');
const httpClient = require('../../http-client');

const logger = global.logger;

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

module.exports.getRoles = getRoles;
module.exports.setRoles = setRoles;

