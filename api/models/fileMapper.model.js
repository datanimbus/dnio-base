const mongoose = require('mongoose');

const config = require('../../config');
const definition = require('../helpers/fileMapper.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');

const schema = mongooseUtils.MakeSchema(definition);

schema.plugin(mongooseUtils.metadataPlugin());
schema.index({ fileId: 1, sNo: 1, status: 1 });

mongoose.model('fileMapper', schema, `${config.serviceCollection}.bulkCreate`);