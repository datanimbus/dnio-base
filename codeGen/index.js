const fs = require('fs');
const jsyaml = require('js-yaml');

const { generateDefinition } = require('./createDefinition');
const { generateYaml } = require('./generateYaml');
const { generateYamlSchemaFree } = require('./generateYamlSchemaFree');
const { dotEnvFile } = require('./tempfiles');
const specialFieldsGenrator = require('./special-fields-generator');
const globalDefHelper = require('./globalDefinitionHelper');

const logger = global.logger;

function generateServiceDefinition(serviceDocument) {
	if (serviceDocument.schemaFree) {
		logger.info(`Service ${serviceDocument._id}/${serviceDocument.name} is schema free.`);
		serviceDocument['definitionWithId'] = JSON.parse(JSON.stringify(serviceDocument['definition']));
		serviceDocument['definition'] = serviceDocument['definition'].filter(attr => attr.key != '_id');
	} else {
		logger.info(`Service ${serviceDocument._id}/${serviceDocument.name} is schema enforced.`);
		serviceDocument['definition'] = globalDefHelper(serviceDocument['definition']);
		serviceDocument['definitionWithId'] = JSON.parse(JSON.stringify(serviceDocument['definition']));
		serviceDocument['definition'] = serviceDocument['definition'].filter(attr => attr.key != '_id');
		let definition = generateDefinition(serviceDocument);
		fs.writeFileSync('./api/helpers/service.definition.js', definition, 'utf-8');
	}
	logger.trace(`Service document after mods :: ${JSON.stringify(serviceDocument)}`);
	fs.writeFileSync('./service.json', JSON.stringify(serviceDocument), 'utf-8');
}

function generateSwaggerYAML(serviceDocument) {
	let yamlJSON = {};
	if (serviceDocument.schemaFree) yamlJSON = generateYamlSchemaFree(serviceDocument);
	else yamlJSON = generateYaml(serviceDocument);

	let yamlDump = jsyaml.dump(yamlJSON);
	fs.writeFileSync('./api/swagger/swagger.yaml', yamlDump, 'utf-8');
}

module.exports.init = (serviceDocument, globalDef) => {
	try {
		logger.info(`Generating files :: ${serviceDocument._id}/${serviceDocument.name}`);

		fs.writeFileSync('./globalDef.json', JSON.stringify(globalDef), 'utf-8');

		generateServiceDefinition(serviceDocument);

		generateSwaggerYAML(serviceDocument);

		if (!serviceDocument.schemaFree) fs.writeFileSync('./api/utils/special-fields.utils.js', specialFieldsGenrator.genrateCode(serviceDocument), 'utf-8');

		fs.writeFileSync('./.env', dotEnvFile(serviceDocument), 'utf-8');

		logger.info(`Generated files :: ${serviceDocument._id}/${serviceDocument.name}`);
	} catch (err) {
		logger.error(`ERROR generating files :: ${serviceDocument._id}/${serviceDocument.name} :: `, err);
		throw err;
	}
};