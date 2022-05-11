const mongooseDataType = ['String', 'Number', 'Date', 'Boolean', 'Object', 'Array'];
const systemGlobalSchema = require('./systemGlobalSchema.js');
const globalDef = require('../globalDef.json');

function getGlobalDefinition(id) {
	let obj = globalDef.find(obj => obj._id === id && obj.definition);
	if (!obj) return null;
	return obj.definition[0];
}

function expandSchemaWithGlobalDef(schema) {
	schema = schema.map(attribute => {
		if (attribute.key !== 'properties' && attribute.key !== '_id') {
			if (attribute['type'] == 'Global' || (attribute['properties'] && attribute['properties']['schema'])) {
				if (!attribute['properties']['schema']) throw new Error('Property schema missing for type Global');
				let globalDefinition = getGlobalDefinition(attribute['properties']['schema']);
				globalDefinition.key = attribute.key;
				let properties = attribute['properties'];
				if (!globalDefinition) throw new Error('Library schema not found.');
				attribute = JSON.parse(JSON.stringify(globalDefinition));
				if (properties) attribute['properties'] = JSON.parse(JSON.stringify(properties));
			}
			else if (attribute['properties'] && attribute['properties']['relatedTo']) {
				let sysDef = systemGlobalSchema['Relation'];
				if (sysDef) {
					sysDef.key = attribute.key;
					let properties = attribute['properties'];
					attribute = JSON.parse(JSON.stringify(sysDef));
					if (properties) attribute['properties'] = JSON.parse(JSON.stringify(properties));
				}
			}
			else if (attribute['type'] == 'User') {
				let sysDef = systemGlobalSchema['User'];
				if (sysDef) {
					sysDef.key = attribute.key;
					let properties = attribute['properties'];
					attribute = JSON.parse(JSON.stringify(sysDef));
					if (properties) attribute['properties'] = JSON.parse(JSON.stringify(properties));
				}
			}
			else if (attribute['properties'] && attribute['properties']['password']) {
				let sysDef = systemGlobalSchema['SecureText'];
				if (sysDef) {
					sysDef.key = attribute.key;
					let properties = attribute['properties'];
					let newDef = JSON.parse(JSON.stringify(sysDef));
					if (attribute['properties']['unique']) {
						newDef.definition.forEach(element => {
							if (element.key == 'checksum') element.properties.unique = true;
						});
					}
					attribute = newDef;
					if (properties) attribute['properties'] = JSON.parse(JSON.stringify(properties));
				}
			}
			if (attribute['definition'])
				attribute['definition'] = expandSchemaWithGlobalDef(attribute['definition']);
		}
		return attribute;
	});
	return schema;
}

function expandSchemaWithSystemGlobalDef(schema) {
	schema = schema.map(attribute => {
		if (attribute.key !== 'properties' && attribute.key !== '_id') {
			if (mongooseDataType.indexOf(attribute['type']) == -1 || (attribute['properties'] && attribute['properties']['dateType'])) {
				let sysDef = systemGlobalSchema[attribute['type']];
				if (sysDef) {
					sysDef.key = attribute.key;
					let properties = attribute['properties'];
					attribute = JSON.parse(JSON.stringify(sysDef));
					if (properties) attribute['properties'] = JSON.parse(JSON.stringify(properties));
				}
			}
			if (attribute['definition'] && !(attribute['properties'] && attribute['properties']['dateType']))
				attribute['definition'] = expandSchemaWithSystemGlobalDef(attribute['definition']);
		}
		return attribute;
	});
	return schema;
}

module.exports = (definition) => {
	definition = expandSchemaWithGlobalDef(definition);
	definition = expandSchemaWithSystemGlobalDef(definition);
	return definition;
};