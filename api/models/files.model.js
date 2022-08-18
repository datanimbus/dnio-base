const mongoose = require('mongoose');
const config = require('../../config');
const mongooseUtils = require('../utils/mongoose.utils');
const definition = require('../helpers/files.definition').definition;

const schema = mongooseUtils.MakeSchema(definition);

schema.plugin(mongooseUtils.metadataPlugin());
schema.index({ filename: 1, uploadDate: 1 });

mongoose.model('files', schema, `${config.serviceCollection}.files`);