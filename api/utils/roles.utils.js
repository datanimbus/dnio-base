const fs = require('fs');
const path = require('path');

const config = require('../../config');
const httpClient = require('../../http-client');

const logger = global.logger;

async function getRoles() {
	logger.trace(`Get roles`);
    var options = {
        url: config.baseUrlUSR + '/role/' + config.serviceId,
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
        json: true
    };
    try {
        const res = await httpClient.httpRequest(options);
        logger.trace(`Get roles :: res.statusCode :: ${res.statusCode}`)
        logger.trace(`Get roles :: res.body :: ${JSON.stringify(res.body)}`)
        if (res.statusCode !== 200) {
          logger.error(`Get roles :: ${JSON.stringify(res.body)}`);
          return
        }
        const role = res.body;
        setRoles(role);
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

