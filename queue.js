
const config = require('./config');

const clientId = process.env.HOSTNAME || `${config.app}-${config.serviceCollection}`;

var client = require('@appveen/data.stack-utils').streaming.init(
	process.env.STREAMING_CHANNEL || 'datastack-cluster',
	clientId,
	config.streamingConfig
);

client.on('connect', () => {
	processRolesQueue()
	processHooksQueue()
})

client.on('reconnect', () => {
	processRolesQueue()
	processHooksQueue()
})

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

// Hooks queue
function processHooksQueue() {
	// check if this is running inside a worker
	if (global.doNotSubscribe) return
	logger.info(`Starting subscription to hooks channel`)
  try {
      var opts = client.subscriptionOptions();
      opts.setStartWithLastReceived();
      opts.setDurableName(config.serviceId + '-hooks-durable');
      var subscription = client.subscribe(config.serviceId + '-hooks', config.serviceId + '-hooks', opts);
      subscription.on('message', function (_body) {
          try {
              let bodyObj = JSON.parse(_body.getData());
              logger.debug(`Message from hooks channel :: ${config.serviceId}-hooks :: ${JSON.stringify(bodyObj)}`);
              setHooks(bodyObj);
          } catch (err) {
              logger.error(`Error processing hooks message :: ${err.message}`);
          }
      });
  } catch (err) {
      logger.error(`Hooks channel :: ${err.message}`);
  }
}

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