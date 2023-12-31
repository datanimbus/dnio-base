const mongoose = require('mongoose');

const config = require('../../config');
const definition = require('../helpers/fileTransfers.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');

const schema = mongooseUtils.MakeSchema(definition);

schema.plugin(mongooseUtils.metadataPlugin());
schema.index({ fileId: 1, user: 1, fileName: 1, status: 1 });

mongoose.model('fileTransfers', schema, `${config.serviceCollection}.fileTransfers`);