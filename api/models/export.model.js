const mongoose = require('mongoose');

const config = require('../../config');
const definition = require('../helpers/export.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');

const schema = mongooseUtils.MakeSchema(definition);

schema.plugin(mongooseUtils.metadataPlugin());

mongoose.model('exports', schema, `${config.serviceCollection}.exports`);