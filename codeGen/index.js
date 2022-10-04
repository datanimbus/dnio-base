const fs = require('fs');

const { generateDefinition } = require('./createDefinition');
const { generateYaml } = require('./generateYaml');
const { generateYamlSchemaFree } = require('./generateYamlSchemaFree');
const { dotEnvFile } = require('./tempfiles');
const specialFieldsGenrator = require('./special-fields-generator');
const globalDefHelper = require('./globalDefinitionHelper');

const logger = global.logger;

function generateServiceDefinition(serviceDocument) {
	if (serviceDocument.schemaFree) {
		logger.info(`Service ${serviceDocument._id}/${serviceDocument.name} has no schema.`);
		serviceDocument['definitionWithId'] = JSON.parse(JSON.stringify(serviceDocument['definition']));
		serviceDocument['definition'] = [];
		fs.writeFileSync('./api/helpers/service.definition.js', 'var definition = ' + JSON.stringify({
			"_id": {
				"type": "String"
			},
			"_expireAt": {
				"type": "Date"
			},
			"_metadata": {
				"type": {
					"version": {
						"type": {
							"service": {
								"type": "Number",
								"default": 0
							},
							"release": {
								"type": "String",
								"default": "1.0.0"
							}
						}
					},
					"filemapper": {
						"type": "String"
					},
					"workflow": {
						"type": "String"
					}
				}
			}
		}) + ';\nmodule.exports.definition=definition;', 'utf-8');
	} else {
		logger.info(`Service ${serviceDocument._id}/${serviceDocument.name} is schema validated.`);
		serviceDocument['definition'] = globalDefHelper(serviceDocument['definition']);
		serviceDocument['definitionWithId'] = JSON.parse(JSON.stringify(serviceDocument['definition']));
		serviceDocument['definition'] = serviceDocument['definition'].filter(attr => attr.key != '_id');
		let definition = generateDefinition(serviceDocument);
		fs.writeFileSync('./api/helpers/service.definition.js', definition, 'utf-8');
		logger.debug('Generated service.definition.js');
	}
	logger.trace(`Service document after mods :: ${JSON.stringify(serviceDocument)}`);
	fs.writeFileSync('./service.json', JSON.stringify(serviceDocument), 'utf-8');
	logger.debug('Generated service.json');
}

function generateSwaggerYAML(serviceDocument) {
	let yaml = {};
	if (serviceDocument.schemaFree) yaml = generateYamlSchemaFree(serviceDocument);
	else yaml = generateYaml(serviceDocument);

	fs.writeFileSync('./api/swagger/swagger.yaml', yaml, 'utf-8');
	logger.debug('Generated swagger.yaml');
}

module.exports.init = (serviceDocument) => {
	try {
		serviceDocument.idDetails = serviceDocument['definition'].find(attr => attr.key == '_id');

		generateServiceDefinition(serviceDocument);

		generateSwaggerYAML(serviceDocument);

		// if (!serviceDocument.schemaFree) {
			fs.writeFileSync('./api/utils/special-fields.utils.js', specialFieldsGenrator.genrateCode(serviceDocument), 'utf-8');
			logger.debug('Generated special-fields.utils.js');
		// }

		fs.writeFileSync('./.env', dotEnvFile(serviceDocument), 'utf-8');
		logger.debug('Generated .env');

		logger.info(`All files generated for ${serviceDocument._id}/${serviceDocument.name}`);
	} catch (err) {
		logger.error(`ERROR generating files :: ${serviceDocument._id}/${serviceDocument.name} :: `, err);
		throw err;
	}
};