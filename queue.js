

const clients = require('@appveen/odp-utils').natsStreaming;
const config = require('./config');

const clientId = config.isK8sEnv() ? process.env.HOSTNAME : (config.app + '-' + config.serviceCollection);
const client = clients.init('odp-cluster', clientId, config.NATSConfig);

/**
 * 
 * @param {*} data The Object that needs to be pushed into the queue
 */
function sendToQueue(data) {
    client.publish(config.queueName, JSON.stringify(data, null, 4));
};



module.exports = {
    client: client,
    sendToQueue: sendToQueue
}

