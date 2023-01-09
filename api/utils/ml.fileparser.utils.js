const httpClient = require('../../http-client');
const config = require('../../config');

const log4js = require('log4js');
const logger = log4js.getLogger(global.loggerName);

let e = {};

e.addFileParserQueueItem = async (txnID, data) => {
	config.fileAttachmentAttributes.forEach(attribute => {
		if (!data[attribute]) return;
		let payload = {
			app: config.app,
			db: config.serviceDB,
			collection: config.serviceCollection,
			documentId: data._id,
			attribute: attribute,
			fileId: data[attribute]._id,
			fileName: data[attribute].filename,
			contentType: data[attribute].contentType,
			metatdataFileName: data[attribute].metadata.filename,
			status: 'pending'
		};
		logger.trace(`[${txnID}] ML fileparser queue payload : ${JSON.stringify(payload)}`);
		logger.trace(`[${txnID}] SM URL :: ${config.baseUrlSM}/${config.app}/internal/filequeue`);
		const options = {
			url: `${config.baseUrlSM}/${config.app}/internal/filequeue`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			json: true,
			body: payload
		};
		httpClient.httpRequest(options).then(() => logger.debug(`[${txnID}] ML fileparser queue payload added for document ${payload.documentId}/${payload.fileId}`))
			.catch(err => logger.error(`Error pinging SM :: ${err.message}`));
	});
};

module.exports = e;