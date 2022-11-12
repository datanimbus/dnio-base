const httpClient = require('./http-client');

const namespace = process.env.DATA_STACK_NAMESPACE || 'appveen';
const appNamespace = process.env.DATA_STACK_APP_NS;
const serviceId = process.env.SERVICE_ID;

const isK8sEnv = function () {
	return process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT;
};

let baseUrlSM = 'http://localhost:10003';
if (isK8sEnv) baseUrlSM = `http://sm.${namespace}`;

const e = { namespace, appNamespace, serviceId };

e.LOGGER_NAME = isK8sEnv() ? `[${process.env.HOSTNAME}] [${serviceId}]` : `[${serviceId}]`;

e.init = async () => {
	let logger = global.logger;
	logger.info('INIT :: Fetch env variables');
	const options = {
		url: `${baseUrlSM}/sm/internal/ds/env`,
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
		},
		json: true
	};
	let envFromSM = await httpClient.httpRequest(options);
	logger.info(envFromSM.body);
	envFromSM = envFromSM.body;

	Object.keys(envFromSM).forEach(env => {
		logger.info(`INIT :: ${env} :: ${process.env[env]}`);
		process.env[env] = process.env[env] ? process.env[env] : envFromSM[env];
		logger.info(`INIT :: ${env} :: ${process.env[env]}`);
	});
};

module.exports = e;