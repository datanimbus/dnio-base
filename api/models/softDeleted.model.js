const mongoose = require('mongoose');
const config = require('../../config');
const definition = require('../helpers/service.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');

const schema = mongooseUtils.MakeSchema(definition);

if(!config.permanentDelete) {
	schema.plugin(mongooseUtils.metadataPlugin());
	mongoose.model(config.serviceId + '.deleted', schema, config.serviceCollection + '.deleted');    
}
