const fs = require('fs');
const e = {};

e.isK8sEnv = function () {
	return process.env.KUBERNETES_SERVICE_HOST && process.env.KUBERNETES_SERVICE_PORT && process.env.ODPENV == 'K8s';
};

e.hookConnectionTimeout = parseInt(process.env.HOOK_CONNECTION_TIMEOUT) || 30;
e.mongoUrl = process.env.MONGO_APPCENTER_URL || 'mongodb://localhost';
e.authorDB = process.env.MONGO_AUTHOR_DBNAME || 'odpConfig';
e.mongoAuthorUrl = process.env.MONGO_AUTHOR_URL || 'mongodb://localhost';
e.mongoLogUrl = process.env.MONGO_LOGS_URL || 'mongodb://localhost';
e.logsDB = process.env.MONGO_LOGS_DBNAME || 'odpLogs';
e.googleKey = process.env.GOOGLE_API_KEY || '';
e.queueName = 'webHooks';
e.NATSConfig = {
	url: process.env.NATS_HOST || 'nats://127.0.0.1:4222',
	user: process.env.NATS_USER || '',
	pass: process.env.NATS_PASS || '',
	maxReconnectAttempts: process.env.NATS_RECONN_ATTEMPTS || 500,
	reconnectTimeWait: process.env.NATS_RECONN_TIMEWAIT || 500
};
e.mongoOptions = {
	reconnectTries: process.env.MONGO_RECONN_TRIES,
	reconnectInterval: process.env.MONGO_RECONN_TIME,
	useNewUrlParser: true
};
e.allowedExt = 'ppt,xls,csv,doc,jpg,png,apng,gif,webp,flif,cr2,orf,arw,dng,nef,rw2,raf,tif,bmp,jxr,psd,zip,tar,rar,gz,bz2,7z,dmg,mp4,mid,mkv,webm,mov,avi,mpg,mp2,mp3,m4a,oga,ogg,ogv,opus,flac,wav,spx,amr,pdf,epub,exe,swf,rtf,wasm,woff,woff2,eot,ttf,otf,ico,flv,ps,xz,sqlite,nes,crx,xpi,cab,deb,ar,rpm,Z,lz,msi,mxf,mts,blend,bpg,docx,pptx,xlsx,3gp,3g2,jp2,jpm,jpx,mj2,aif,qcp,odt,ods,odp,xml,mobi,heic,cur,ktx,ape,wv,wmv,wma,dcm,ics,glb,pcap,dsf,lnk,alias,voc,ac3,m4v,m4p,m4b,f4v,f4p,f4b,f4a,mie,asf,ogm,ogx,mpc'.split(',');

e.hostname = process.env.HOSTNAME;
e.namespace = process.env.ODP_NAMESPACE || 'appveen';
e.app = process.env.ODP_APP || 'Adam';
e.appNamespace = process.env.ODP_APP_NS;
e.servicePort = process.env.SERVICE_PORT;
e.serviceId = process.env.SERVICE_ID;
e.serviceName = process.env.SERVICE_NAME;
e.serviceDB = process.env.ODP_NAMESPACE + '-' + process.env.ODP_APP;
e.serviceEndpoint = process.env.SERVICE_ENDPOINT;
e.serviceCollection = process.env.SERVICE_COLLECTION;
e.permanentDelete = process.env.PERMANENT_DELETE;

// ID Config ENV Varaiables
e.ID_PADDING = process.env.ID_PADDING;
e.ID_PREFIX = process.env.ID_PREFIX;
e.ID_SUFFIX = process.env.ID_SUFFIX;
e.ID_COUNTER = process.env.ID_COUNTER;

e.baseUrlSM = get('sm') + '/sm';
e.baseUrlNE = get('ne') + '/ne';
e.baseUrlUSR = get('user') + '/rbac';
e.baseUrlMON = get('mon') + '/mon';
e.baseUrlWF = get('wf') + '/workflow';
e.baseUrlSEC = get('sec') + '/sec';
e.baseUrlDM = get('dm') + '/dm';
e.baseUrlPM = get('pm') + '/pm';
e.baseUrlGW = get('gw');

function getHostOSBasedLocation() {
	if (process.env.PLATFORM == 'NIX') return 'localhost';
	return 'host.docker.internal';
}

function get(_service) {
	if (e.isK8sEnv()) {
		if (_service == 'dm') return `http://dm.${e.namespace}`;
		if (_service == 'ne') return `http://ne.${e.namespace}`;
		if (_service == 'sm') return `http://sm.${e.namespace}`;
		if (_service == 'pm') return `http://pm.${e.namespace}`;
		if (_service == 'user') return `http://user.${e.namespace}`;
		if (_service == 'gw') return `http://gw.${e.namespace}`;
		if (_service == 'wf') return `http://wf.${e.namespace}`;
		if (_service == 'sec') return `http://sec.${e.namespace}`;
		if (_service == 'mon') return `http://mon.${e.namespace}`;
		if (_service == 'gw') return `http://gw.${e.namespace}`;
	} else if (fs.existsSync('/.dockerenv')) {
		if (_service == 'dm') return 'http://' + getHostOSBasedLocation() + ':10709';
		if (_service == 'ne') return 'http://' + getHostOSBasedLocation() + ':10010';
		if (_service == 'sm') return 'http://' + getHostOSBasedLocation() + ':10003';
		if (_service == 'pm') return 'http://' + getHostOSBasedLocation() + ':10011';
		if (_service == 'user') return 'http://' + getHostOSBasedLocation() + ':10004';
		if (_service == 'gw') return 'http://' + getHostOSBasedLocation() + ':9080';
		if (_service == 'wf') return 'http://' + getHostOSBasedLocation() + ':10006';
		if (_service == 'sec') return 'http://' + getHostOSBasedLocation() + ':10007';
		if (_service == 'mon') return 'http://' + getHostOSBasedLocation() + ':10005';
		if (_service == 'gw') return 'http://' + getHostOSBasedLocation() + ':9080';
	} else {
		if (_service == 'dm') return 'http://localhost:10709';
		if (_service == 'ne') return 'http://localhost:10010';
		if (_service == 'sm') return 'http://localhost:10003';
		if (_service == 'pm') return 'http://localhost:10011';
		if (_service == 'user') return 'http://localhost:10004';
		if (_service == 'gw') return 'http://localhost:9080';
		if (_service == 'wf') return 'http://localhost:10006';
		if (_service == 'sec') return 'http://localhost:10007';
		if (_service == 'mon') return 'http://localhost:10005';
		if (_service == 'gw') return 'http://localhost:9080';
	}
}

module.exports = e;