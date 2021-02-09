const mongoose = require('mongoose');

const config = require('../../config');
const definition = require('../helpers/fileTransfers.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');

const schema = new mongoose.Schema(definition, {
	usePushEach: true
});

schema.plugin(mongooseUtils.metadataPlugin());

mongoose.model('fileTransfers', schema, `${config.serviceCollection}.fileTransfers`);