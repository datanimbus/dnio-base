const fs = require('fs');
const path = require('path');

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

		if (envFromSM['DB_AUTHOR_CERT']) {
			fs.writeFileSync(path.join(process.cwd(), '../../', envFromSM['DB_AUTHOR_CERT_NAME']), envFromSM['DB_AUTHOR_CERT']);
			delete envFromSM['DB_AUTHOR_CERT'];
		}
		if (envFromSM['DB_APPCENTER_CERT']) {
			fs.writeFileSync(path.join(process.cwd(), '../../', envFromSM['DB_APPCENTER_CERT_NAME']), envFromSM['DB_APPCENTER_CERT']);
			delete envFromSM['DB_APPCENTER_CERT'];
		}
		if (envFromSM['DB_LOGS_CERT']) {
			fs.writeFileSync(path.join(process.cwd(), '../../', envFromSM['DB_LOGS_CERT_NAME']), envFromSM['DB_LOGS_CERT']);
			delete envFromSM['DB_LOGS_CERT'];
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