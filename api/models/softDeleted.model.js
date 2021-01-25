const definition = require('../helpers/service.definition').definition;
const config = require('../../config');

const schema = new mongoose.Schema(definition, {
    usePushEach: true
});
if(!config.permanentDelete) {
    schema.plugin(mongooseUtils.metadataPlugin());
    mongoose.model(config.serviceId + '.deleted', schema, config.serviceCollection + '.deleted');    
}
