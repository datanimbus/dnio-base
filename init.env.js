const fs = require('fs');

const httpClient = require('./http-client');

const namespace = process.env.DATA_STACK_NAMESPACE || 'appveen';
const appNamespace = process.env.DATA_STACK_APP_NS;
const serviceId = process.env.SERVICE_ID;

const e = { namespace, appNamespace, serviceId };

e.isK8sEnv = function () {
	return process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT;
};


let baseUrlSM = 'http://localhost:10003';
if (e.isK8sEnv()) baseUrlSM = `http://sm.${namespace}`;


e.init = async () => {
	try {
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

		if (envFromSM['DNIO_DATABASE_CERT']) {
			fs.writeFileSync(envFromSM['DNIO_DATABASE_CERT_NAME'], envFromSM['DNIO_DATABASE_CERT']);
			delete envFromSM['DNIO_DATABASE_CERT'];
		}
		
		fs.writeFileSync('envVars.json', JSON.stringify(envFromSM));
	} catch (err) {
		console.log(err);
		process.exit(0);
	}
};

e.loadEnvVars = () => {
	let envFromFile = require('./envVars.json');
	Object.keys(envFromFile).forEach(env => {
		process.env[env] = process.env[env] ? process.env[env] : envFromFile[env];
	});
};

module.exports = e;