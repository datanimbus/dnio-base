const config = require('./config');

let logger = global.logger;

let clientId = process.env.HOSTNAME || `${config.app}-${config.serviceCollection}`;
clientId = clientId + Math.floor(Math.random() * 10000);

logger.debug(`STREAMING_CHANNEL : ${process.env.STREAMING_CHANNEL || 'datastack-cluster'}`);
logger.debug(`CLIENT_ID : ${clientId}`);

var client = require('@appveen/data.stack-utils').streaming.init(
	process.env.STREAMING_CHANNEL || 'datastack-cluster',
	clientId,
	config.streamingConfig
);

/**
 * 
 * @param {*} data The Object that needs to be pushed into the queue
 */
function sendToQueue(data) {
	logger.trace(`Push to Q ${config.queueName} - ${JSON.stringify(data)}`);
	client.publish(config.queueName, JSON.stringify(data, null, 4));
}

module.exports = {
	client: client,
	sendToQueue: sendToQueue
};