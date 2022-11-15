const fs = require('fs');
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
	envFromSM = envFromSM.body;

	fs.writeFileSync('envVars.json', JSON.stringify(envFromSM));
};

e.loadEnvVars = () => {
	let envFromFile = require('./envVars.json');
	Object.keys(envFromFile).forEach(env => {
		process.env[env] = process.env[env] ? process.env[env] : envFromFile[env];
	});
};

module.exports = e;