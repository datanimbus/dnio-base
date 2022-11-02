const logger = global.logger;

function dotEnvFile(config) {
	return `
NODE_ENV="development"
MONGO_APPCENTER_URL="${process.env.MONGO_APPCENTER_URL}"
MONGO_AUTHOR_URL="${process.env.MONGO_AUTHOR_URL}"
MONGO_LOGS_URL="${process.env.MONGO_LOGS_URL}"
ODP_APP="${config.app}"
SERVICE_ID="${config._id}"
SERVICE_NAME="${config.name}"
SERVICE_VERSION="${config.version}"
SERVICE_PORT="${config.port}"
SERVICE_ENDPOINT="${config.api}"
SERVICE_COLLECTION="${config.collectionName}"
ID_PADDING="${config.idDetails.padding || ''}"
ID_PREFIX="${config.idDetails.prefix || ''}"
ID_SUFFIX="${config.idDetails.suffix || ''}"
ID_COUNTER="${config.idDetails.counter}"
PERMANENT_DELETE=${config.permanentDeleteData}
HOSTNAME="localhost"
DATA_STACK_APP_NS="appveen-${config.app}"
DATA_STACK_NAMESPACE="appveen"
DATA_STACK_APP="${config.app}"
DATA_STACK_ALLOWED_FILE_TYPE="${config.allowedFileTypes}"
STORAGE_ENGINE="${config?.fileStorage?.type || "MongoDB"}"
${ config.fileStorage?.type === 'AZBLOB' ?
`STORAGE_AZURE_CONNECTION_STRING="${config.fileStorage?.AZURE?.connectionString}"
STORAGE_AZURE_CONTAINER="${config.fileStorage?.AZURE?.container}"
STORAGE_AZURE_SHARED_KEY="${config.fileStorage?.AZURE?.sharedKey}"
STORAGE_AZURE_TIMEOUT="${config.fileStorage?.AZURE?.timeout}"` : ``
}
${ config.fileStorage?.type === 'S3' ?
`STORAGE_S3_ACCESS_KEY_ID="${config.fileStorage?.S3?.accessKeyId}"
STORAGE_S3_SECRET_ACCESS_KEY="${config.fileStorage?.S3?.secretAccessKey}"
STORAGE_S3_REGION="${config.fileStorage?.S3?.region}"
STORAGE_S3_BUCKET="${config.fileStorage?.S3?.bucket}"` : ``
}
`;
}

function gcsFile(config) {
	return {
		'type': 'service_account',
		'project_id': config.projectId,
		'private_key_id': config.privateKeyId,
		'private_key': config.privateKey,
		'client_email': config.clientEmail,
		'client_id': config.clientId,
		'auth_uri': config.authURI,
		'token_uri': config.tokenURI,
		'auth_provider_x509_cert_url': config.authCertURL,
		'client_x509_cert_url': config.clientCertURL
	};
}

module.exports = {
	dotEnvFile,
	gcsFile
};
