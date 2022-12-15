const mongoose = require('mongoose');

const config = require('../../config');
const definition = require('../helpers/dedupe.definition').definition;
const mongooseUtils = require('../utils/mongoose.utils');

const schema = mongooseUtils.MakeSchema(definition);

schema.plugin(mongooseUtils.metadataPlugin());

mongoose.model('dedupe', schema, `${config.serviceCollection}.dedupe`);

schema.pre('save', function (next) {
	let doc = this.toObject();
	Object.keys(doc).forEach(el => this.markModified(el));
	next();
});