const mongoose = require('mongoose');

const config = require('../../config');
const definition = require('../helpers/fileMapper.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');

const schema = new mongoose.Schema(definition, {
    usePushEach: true
});

let model;

schema.plugin(mongooseUtils.metadataPlugin());

model = mongoose.model('fileMapper', schema, `${config.serviceCollection}.bulkCreate`);