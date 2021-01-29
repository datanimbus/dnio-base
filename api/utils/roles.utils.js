const fs = require('fs');
const path = require('path');

const config = require('../../config');
const queueMgmt = require('../../queue');
const httpClient = require('../../http-client');

const logger = global.logger;
const client = queueMgmt.client;

async function getRoles() {
	logger.trace(`Get roles`);
    var options = {
        url: config.baseUrlUSR + '/role/' + config.serviceId,
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'TxnId': `${process.env.SERVICE_ID}_${Date.now()}`,
            'User': 'AUTO-FETCH'
        },
        json: true
    };
    try {
        const res = await httpClient.httpRequest(options);
        if (res.statusCode !== 200) {
          logger.error(`Get roles :: ${JSON.stringify(res.body)}`);
          return
        }
        const role = res.body;
        setRoles(role);
        processRolesQueue();
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

function processRolesQueue() {
    try {
        var opts = client.subscriptionOptions();
        opts.setStartWithLastReceived();
        opts.setDurableName(config.serviceId + '-role-durable');
        var subscription = client.subscribe(config.serviceId + '-role', config.serviceId + '-role', opts);
        subscription.on('message', function (_body) {
            try {
                let bodyObj = JSON.parse(_body.getData());
                logger.debug(`Message from queue :: ${config.serviceId}-role :: ${JSON.stringify(bodyObj)}`);
                setRoles(bodyObj);
            } catch (err) {
                logger.error(`Processing roles queue :: ${err.message}`);
            }
        });
    } catch (err) {
        logger.error(`Processing roles queue :: ${err.message}`);
    }
}


module.exports.getRoles = getRoles;
module.exports.setRoles = setRoles;

