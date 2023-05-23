const _ = require('lodash');
const jsyaml = require('js-yaml');
const getParameters = [
	{
		name: 'page',
		in: 'query',
		type: 'integer',
		description: 'Page number of the request'
	},
	{
		name: 'count',
		in: 'query',
		type: 'integer',
		description: 'Number of records per page'
	},
	{
		name: 'authorization',
		in: 'header',
		type: 'string',
		description: 'The JWT token for req.validation'
	},
	{
		name: 'filter',
		in: 'query',
		type: 'string',
		description: 'Filter records based on certain fields'
	},
	{
		name: 'select',
		in: 'query',
		type: 'string',
		description: 'Comma seperated fields to be displayed'
	},
	{
		name: 'sort',
		in: 'query',
		type: 'string',
		description: 'sort parameter'
	}
];

const bulkShowParameters = [{
	name: 'id',
	in: 'query',
	type: 'string',
	description: 'comma separated ids'
},
{
	name: 'select',
	in: 'query',
	type: 'string',
	description: 'Comma seperated fields to be displayed'
},
{
	name: 'sort',
	in: 'query',
	type: 'string',
	description: 'sort parameter'
},
{
	name: 'authorization',
	in: 'header',
	type: 'string',
	description: 'The JWT token for req.validation'
}
];

const bulkDeleteParameters = [
	{
		name: 'authorization',
		in: 'header',
		type: 'string',
		description: 'The JWT token for req.validation'
	}, {
		name: 'ids',
		in: 'body',
		description: 'Payload to reset a User',
		schema: {
			type: 'object',
			properties: {
				ids: {
					type: 'array',
					items: {
						type: 'string'
					}
				}
			}
		}
	}];

const showParameters = [{
	name: 'select',
	in: 'query',
	type: 'string',
	description: 'Comma seperated fields to be displayed'
}, {
	name: 'id',
	in: 'path',
	type: 'string',
	required: true,
	description: 'Id of the object to be updated',
},
{
	name: 'authorization',
	in: 'header',
	type: 'string',
	description: 'The JWT token for req.validation'
}];

const hookParameters = [{
	name: 'url',
	in: 'query',
	type: 'string',
	description: 'Url to hit'
},
{
	name: 'data',
	in: 'body',
	schema: {
		type: 'object'
	},
	description: 'data'
}];
const experienceHookParameters = [
	{
		name: 'name',
		in: 'query',
		type: 'string',
		description: 'name of hook to hit'
	},
	{
		name: 'data',
		in: 'body',
		schema: {
			type: 'object'
		},
		description: 'data'
	}];

const countParameters = [{
	name: 'filter',
	in: 'query',
	type: 'string',
	description: 'Filter records based on certain fields'
},
{
	name: 'authorization',
	in: 'header',
	type: 'string',
	description: 'The JWT token for req.validation'
},
{
	name: 'expand',
	in: 'query',
	type: 'boolean',
	description: 'expand document based on relations',
	default: false
}];

const exportParameters = [{
	name: 'filter',
	in: 'body',
	type: 'string',
	description: 'Filter records based on certain fields'
},
{
	name: 'select',
	in: 'body',
	type: 'string',
	description: 'Comma seperated fields to be displayed'
},
{
	name: 'sort',
	in: 'body',
	type: 'string',
	description: 'sort parameter'
},
{
	name: 'skip',
	in: 'body',
	type: 'integer',
	description: 'Number of records to skip'
},
{
	name: 'batchSize',
	in: 'body',
	type: 'integer',
	description: 'Batch size for cursor'
},
{
	name: 'authorization',
	in: 'header',
	type: 'string',
	description: 'The JWT token for req.validation'
}];


function getType(type) {
	type = type == 'largeString' ? 'String' : type;
	type = type == 'String' ? 'string' : type;
	type = type == 'Number' ? 'number' : type;
	type = type == 'Boolean' ? 'boolean' : type;
	type = type == 'Date' ? 'string' : type;
	return type;
}

function getCreateDefinition(defArr) {
	let definition = [];
	if (defArr[0] && defArr[0].key == '_self') {
		let attribute = defArr[0];
		if (attribute['type'] === 'Object' && !attribute['properties']['schemaFree']) {
			definition = getCreateDefinition(attribute['definition']);
		}
		else if (attribute['type'] === 'User') {
			definition = getCreateDefinition(attribute['definition']);
		} else if (attribute['type'] === 'Array') {
			if (attribute['definition'][0]['type'] === 'Array') {
				definition = {
					type: ['array', 'null'],
					items: getCreateDefinition(attribute['definition'])
				};
			} else {
				definition = getCreateDefinition(attribute['definition']);
			}
		} else {
			definition.type = getType(attribute['type']);
		}
		return definition;
	}
	definition = {
		properties: {},
		required: []
	};
	defArr.forEach(attribute => {
		let el = attribute.key;
		if (attribute['properties'] && attribute['properties']['required']) {
			definition.required.push(el);
		}
		if (el == '_id') {
			attribute['type'] = 'string';
		}
		if (attribute['type'] === 'Object' && !attribute['properties']['schemaFree']) {
			definition['properties'][el] = getCreateDefinition(attribute.definition);
		}
		else if (attribute['type'] === 'User') {
			definition['properties'][el] = getCreateDefinition(attribute.definition);
		} else if (attribute['type'] == 'Array') {
			if (attribute['definition'][0]['type'] === 'Array') {
				definition['properties'][el] = {
					type: ['array', 'null'],
					items: {
						type: ['array', 'null'],
						items: getCreateDefinition(attribute['definition'])
					}
				};
			} else if (attribute['definition'][0]['type'] === 'Object') {
				definition['properties'][el] = {
					type: ['array', 'null'],
					items: getCreateDefinition(attribute['definition'])
				};
			}
			else if (attribute['definition'][0]['type'] === 'User') {
				definition['properties'][el] = {
					type: ['array', 'null'],
					items: getCreateDefinition(attribute['definition'])
				};
			} else {
				definition['properties'][el] = {
					type: ['array', 'null'],
					items: {
						type: getType(attribute['definition'][0]['type'])
					}
				};
			}
		} else {
			if (attribute['properties'] && (attribute['properties']['required'])) {
				definition['properties'][el] = {
					type: getType(attribute['type'])
				};
			} else {
				definition['properties'][el] = {
					type: [getType(attribute['type']), 'null']
				};
			}
			if (attribute['properties'] && attribute['properties']['enum']) {
				definition['properties'][el]['enum'] = attribute['properties']['enum'];
			}
		}
	});
	if (definition.required.length === 0)
		delete definition.required;
	return definition;
}

function getMathKeyList(defArr, key) {
	let list = [];
	defArr.forEach(attribute => {
		let _k = attribute.key;
		let newKey = key == '' ? _k : key + '.' + _k;
		if (attribute['type'] === 'Object' && !attribute['properties']['schemaFree']) {
			list = list.concat(getMathKeyList(attribute['definition'], newKey));
		} else if (attribute['type'] === 'Number') {
			list.push(newKey);
		}
	});
	return list;
}

function getUpdateDefinition(def) {
	if (def.constructor == {}.constructor && def['required']) {
		delete def.required;
	}
	if (Array.isArray(def)) {
		def.forEach(attr => {
			if (attr != null && typeof attr === 'object')
				getUpdateDefinition(attr);
		});
	} else if (def.constructor == {}.constructor) {
		Object.keys(def).forEach(key => {
			if (def[key] != null && typeof def[key] === 'object')
				getUpdateDefinition(def[key]);
		});
	}
}

function getMethodNames(config) {
	var name = _.camelCase(config._id);
	var obj = {};
	obj.create = `v1_${name}Create`;
	obj.exportAll = `v1_${name}Export`;
	obj.exportAllDetail = `v1_${name}ExportDetails`;
	obj.exportAllDetailCount = `v1_${name}ExportDetailsCount`;
	obj.exportAllDetailDelete = `v1_${name}ExportDetailsDelete`;
	obj.list = `v1_${name}List`;
	obj.show = `v1_${name}Show`;
	obj.update = `v1_${name}Update`;
	obj.hook = `v1_${name}Hook`;
	obj.experienceHook = `v1_${name}ExperienceHook`;
	obj.math = `v1_${name}Math`;
	obj.destroy = `v1_${name}Destroy`;
	obj.count = `v1_${name}Count`;
	obj.bulkShow = `v1_${name}BulkShow`;
	obj.securedFields = `v1_${name}SecuredFields`;
	obj.bulkDelete = `v1_${name}BulkDelete`;
	obj.fileUpload = `v1_${name}FileUpload`;
	obj.fileView = `v1_${name}FileView`;
	obj.fileDownload = `v1_${name}FileDownload`;
	obj.exportFileileDownload = `v1_${name}ExportedFileDownload`;
	obj.fileRemove = `v1_${name}FileRemove`;
	obj.healthCheck = `v1_${name}HealthCheck`;
	obj.readinessCheck = `v1_${name}ReadinessCheck`;
	obj.simulate = `v1_${name}Simulate`;
	obj.lock = `v1_${name}LockDocument`;
	obj.controller = 'controller';
	return obj;
}

function generateYaml(config) {
	var methodName = getMethodNames(config);
	var createDefinition = getCreateDefinition(config.definition);
	var updateDefinition = JSON.parse(JSON.stringify(createDefinition));
	let mathKeyList = getMathKeyList(JSON.parse(JSON.stringify(config.definition)), '');
	let mathDefinition = null;
	if (mathKeyList.length > 0) {
		let mathKeyObject = {};
		mathKeyList.forEach(_k => {
			mathKeyObject[_k] = { 'type': 'number' };
		});
		mathDefinition = { 'properties': { '$inc': { 'type': 'object', 'properties': JSON.parse(JSON.stringify(mathKeyObject)) }, '$mul': { 'type': 'object', 'properties': JSON.parse(JSON.stringify(mathKeyObject)) } } };
	}
	getUpdateDefinition(updateDefinition);
	var basePath = config.api.charAt(0) === '/' ? config.api : '/' + config.api;
	var swagger = {
		swagger: '2.0',
		info: {
			version: `${config.version}`,
			title: config.name + ' API'
		},
		host: 'localhost:' + config.port,
		basePath: '/' + config.app + basePath,
		schemes: ['http'],
		consumes: ['application/json', 'multipart/form-data'],
		produces: ['application/json', 'text/plain'],
		paths: {},
		definitions: {}
	};
	var name = _.camelCase(config.name);
	swagger.definitions[`${name}_create`] = createDefinition;
	swagger.definitions[`${name}_update`] = updateDefinition;
	if (mathDefinition) swagger.definitions[`${name}_math`] = mathDefinition;
	swagger.definitions['mapping'] = {
		'properties': {
			'headers': {
				'type': ['string']
			},
			'headerMapping': {
				'type': ['string']
			}
		}
	};
	// swagger.definitions['enrichData'] = {
	// 	'properties': {
	// 		'sheetData': {
	// 			'type': ['array'],
	// 			'items': {
	// 				'type': 'object'
	// 			}
	// 		},
	// 		'headerMapping': {
	// 			'type': ['object']
	// 		}
	// 	}
	// };
	swagger.definitions['bulkCreateData'] = {
		'properties': {
			'fileId': {
				'type': 'string'
			}
		}
	};
	let expandOption = {
		name: 'expand',
		in: 'query',
		type: 'boolean',
		description: 'expand document based on relations',
		default: false
	};

	let totalRecord = {
		name: 'totalRecords',
		in: 'query',
		type: 'integer',
		description: 'total records',
	};

	let searchOption = {
		name: 'search',
		in: 'query',
		type: 'string',
		description: 'String to search across all field'
	};
	swagger.paths['/'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'get': {
			description: `Retrieve a list of '${config.name}'`,
			operationId: `${methodName.list}`,
			parameters: config.enableSearchIndex ? JSON.parse(JSON.stringify(getParameters)).concat([expandOption, searchOption]) : JSON.parse(JSON.stringify(getParameters)).concat([expandOption]),
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		},
		'post': {
			description: `Create a new '${config.name}'`,
			operationId: `${methodName.create}`,
			parameters: [{
				name: 'data',
				in: 'body',
				description: `Payload to create a '${config.name}'`,
				schema: {
					$ref: `#/definitions/${name}_create`
				}
			},
			{
				name: 'authorization',
				in: 'header',
				type: 'string',
				description: 'The JWT token for req.validation'
			},
			{
				name: 'expireAt',
				in: 'query',
				type: 'string',
				description: 'ISO format date after which the document will get deleted'
			},
			{
				name: 'expireAfter',
				in: 'query',
				type: 'string',
				description: 'Time after which the document will get deleted.'
			},
			{
				name: 'upsert',
				in: 'query',
				type: 'boolean',
				description: 'upsert parameter'
			}],
			responses: {
				'200': {
					description: 'List of the entites created'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/simulate'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'post': {
			description: `validate '${config.name}'`,
			operationId: `${methodName.simulate}`,
			parameters: [{
				name: 'data',
				in: 'body',
				description: `Payload to validate '${config.name}'`,
				schema: {
					$ref: `#/definitions/${name}_update`
				}
			},
			{
				name: 'authorization',
				in: 'header',
				type: 'string',
				description: 'The JWT token for req.validation'
			},
			{
				name: 'generateId',
				in: 'query',
				type: 'boolean',
				description: 'Generate Id for the document',
				default: false
			},
			{
				name: 'operation',
				in: 'query',
				type: 'string',
				description: 'request method',
				default: false
			},
			{
				name: 'docId',
				in: 'query',
				type: 'string',
				description: 'request method',
				default: false
			},
			{
				name: 'select',
				in: 'query',
				type: 'string',
				description: 'select in case of get',
				default: false
			}],
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	// Was Used by WF Module
	// swagger.paths['/utils/lock'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'put': {
	// 		description: `lock '${config.name}'`,
	// 		operationId: `${methodName.lock}`,
	// 		parameters: [{
	// 			name: 'data',
	// 			in: 'body',
	// 			description: `Payload to validate '${config.name}'`,
	// 			schema: {
	// 				properties: {
	// 					'id': {
	// 						'type': 'string',
	// 					},
	// 					'wfId': {
	// 						'type': ['string', 'null'],
	// 					}
	// 				}
	// 			}
	// 		},
	// 		{
	// 			name: 'authorization',
	// 			in: 'header',
	// 			type: 'string',
	// 			description: 'The JWT token for req.validation'
	// 		}],
	// 		responses: {
	// 			'200': {
	// 				description: 'List of the entites'
	// 			},
	// 			'400': {
	// 				description: 'Bad parameters'
	// 			},
	// 			'500': {
	// 				description: 'Internal server error'
	// 			}
	// 		}
	// 	}
	// };
	swagger.paths['/utils/bulkShow'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'get': {
			description: `Retrieve a list of '${config.name}'`,
			operationId: `${methodName.bulkShow}`,
			parameters: bulkShowParameters,
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/securedFields'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'get': {
			description: `Retrieve a list of secured fields in '${config.name}'`,
			operationId: `${methodName.securedFields}`,
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/hook'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'post': {
			description: 'triggers the hook with data',
			operationId: `${methodName.hook}`,
			parameters: hookParameters,
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/experienceHook'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'post': {
			description: 'triggers the hook with data',
			operationId: `${methodName.experienceHook}`,
			parameters: experienceHookParameters,
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/bulkDelete'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'delete': {
			description: `Deletes a list of '${name}'`,
			operationId: `${methodName.bulkDelete}`,
			parameters: bulkDeleteParameters,
			responses: {
				'200': {
					description: 'Empty Object'
				},
				'400': {
					description: 'List document ids not deleted'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/count'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'get': {
			description: `returns count of '${config.name}'`,
			operationId: `${methodName.count}`,
			parameters: countParameters,
			responses: {
				'200': {
					description: 'Count of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/{id}'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'get': {
			description: `Retrieve an existing '${config.name}'`,
			operationId: `${methodName.show}`,
			parameters: showParameters.concat([{
				name: 'expand',
				in: 'query',
				type: 'boolean',
				description: 'expand document based on relations',
				default: false
			}]),
			responses: {
				'200': {
					description: `${config.name} document`
				},
				'400': {
					description: 'Bad parameters'
				},
				'404': {
					description: 'No records to list with the given parameter set.'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		},
		'put': {
			description: `Update an existing '${config.name}'`,
			operationId: `${methodName.update}`,
			parameters: [{
				name: 'data',
				in: 'body',
				description: `Payload to update a '${config.name}'`,
				schema: {
					$ref: `#/definitions/${name}_update`
				}
			}, {
				name: 'id',
				in: 'path',
				type: 'string',
				required: true,
				description: `Id of the '${config.name}' to be updated`,
			},
			{
				name: 'authorization',
				in: 'header',
				type: 'string',
				description: 'The JWT token for req.validation'
			},
			{
				name: 'expireAt',
				in: 'query',
				type: 'string',
				description: 'ISO format date after which the document will get deleted'
			},
			{
				name: 'expireAfter',
				in: 'query',
				type: 'string',
				description: 'Time after which the document will get deleted.'
			}, {
				name: 'upsert',
				in: 'query',
				type: 'boolean',
				description: 'upsert parameter'
			}],
			responses: {
				'200': {
					description: 'Update entry'
				},
				'400': {
					description: 'Bad parameters'
				},
				'404': {
					description: 'No records to list with the given parameter set.'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		},
		'delete': {
			description: `Delete an existing '${config.name}'`,
			operationId: `${methodName.destroy}`,
			parameters: [{
				name: 'id',
				in: 'path',
				type: 'string',
				required: true,
				description: `Id of the '${config.name}' to be deleted`,
			},
			{
				name: 'authorization',
				in: 'header',
				type: 'string',
				description: 'The JWT token for req.validation'
			}],
			responses: {
				'200': {
					description: 'Empty object'
				},
				'400': {
					description: 'Bad parameters'
				},
				'404': {
					description: 'No records to list with the given parameter set.'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	if (mathDefinition) {
		swagger.paths['/{id}/math'] = {
			'x-swagger-router-controller': `${methodName.controller}`,
			'put': {
				description: `Does math operation on a '${config.name}'`,
				operationId: `${methodName.math}`,
				parameters: [{
					name: 'data',
					in: 'body',
					description: `Payload to update a '${config.name}'`,
					schema: {
						$ref: `#/definitions/${name}_math`
					}
				}, {
					name: 'id',
					in: 'path',
					type: 'string',
					required: true,
					description: `Id of the '${config.name}' to be updated`,
				},
				{
					name: 'authorization',
					in: 'header',
					type: 'string',
					description: 'The JWT token for req.validation'
				}],
				responses: {
					'200': {
						description: 'Update entry'
					},
					'400': {
						description: 'Bad parameters'
					},
					'404': {
						description: 'No records to list with the given parameter set.'
					},
					'500': {
						description: 'Internal server error'
					}
				}
			}
		};
	}

	// swagger.paths['/utils/file/upload'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'post': {
	// 		description: 'Uploads the file',
	// 		operationId: `${methodName.fileUpload}`,
	// 		parameters: [
	// 			{
	// 				name: 'authorization',
	// 				in: 'header',
	// 				type: 'string',
	// 				description: 'The JWT token for req.validation'
	// 			}
	// 		],
	// 		responses: {
	// 			'200': {
	// 				description: 'meta data of file'
	// 			},
	// 			'400': {
	// 				description: 'Bad parameters'
	// 			},
	// 			'500': {
	// 				description: 'Internal server error'
	// 			}
	// 		}
	// 	}
	// };

	// swagger.paths['/utils/file/{id}/view'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'get': {
	// 		description: 'View the file',
	// 		parameters: [{
	// 			name: 'id',
	// 			in: 'path',
	// 			type: 'string',
	// 			required: true,
	// 			description: 'Id of file',
	// 		}, {
	// 			name: 'authorization',
	// 			in: 'header',
	// 			type: 'string',
	// 			description: 'The JWT token for req.validation'
	// 		}],
	// 		operationId: `${methodName.fileView}`,
	// 		responses: {
	// 			'200': {
	// 				description: 'file data'
	// 			},
	// 			'400': {
	// 				description: 'Bad parameters'
	// 			},
	// 			'500': {
	// 				description: 'Internal server error'
	// 			}
	// 		}
	// 	}
	// };

	// swagger.paths['/utils/file/download/{id}'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'get': {
	// 		description: 'Download the file',
	// 		parameters: [{
	// 			name: 'id',
	// 			in: 'path',
	// 			type: 'string',
	// 			required: true,
	// 			description: 'Id of file',
	// 		}],
	// 		operationId: `${methodName.fileDownload}`,
	// 		responses: {
	// 			'200': {
	// 				description: 'file download'
	// 			},
	// 			'400': {
	// 				description: 'Bad parameters'
	// 			},
	// 			'500': {
	// 				description: 'Internal server error'
	// 			}
	// 		}
	// 	}
	// };

	swagger.paths['/utils/export/download/{id}'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'get': {
			description: 'Download the file',
			parameters: [{
				name: 'id',
				in: 'path',
				type: 'string',
				required: true,
				description: 'Id of file',
			}, {
				name: 'filename',
				in: 'query',
				type: 'string',
				description: 'filename of file',
			}],
			operationId: `${methodName.exportFileileDownload}`,
			responses: {
				'200': {
					description: 'file download'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	// swagger.paths['/utils/fileMapper/{fileId}'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'get': {
	// 		description: `Retrieve a list of '${config.name}'`,
	// 		operationId: 'fileMapperList',
	// 		parameters: JSON.parse(JSON.stringify(getParameters.concat({
	// 			name: 'fileId',
	// 			in: 'path',
	// 			required: true,
	// 			type: 'string',
	// 			description: 'fileId against which we db will be querried'
	// 		}))),
	// 		responses: {
	// 			'200': {
	// 				description: 'List of the entites'
	// 			},
	// 			'400': {
	// 				description: 'Bad parameters'
	// 			},
	// 			'500': {
	// 				description: 'Internal server error'
	// 			}
	// 		}
	// 	}
	// };
	// swagger.paths['/utils/fileMapper/{fileId}/create'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'post': {
	// 		description: 'Create the data in the file',
	// 		operationId: 'v1_bulkCreate',
	// 		parameters: [{
	// 			name: 'data',
	// 			in: 'body',
	// 			description: 'Payload to bulkCreate',
	// 			schema: {
	// 				$ref: '#/definitions/bulkCreateData'
	// 			}
	// 		}, {
	// 			name: 'authorization',
	// 			in: 'header',
	// 			type: 'string',
	// 			description: 'The JWT token for req.validation'
	// 		}, {
	// 			name: 'fileId',
	// 			in: 'path',
	// 			required: true,
	// 			type: 'string',
	// 			description: 'fileId against which we db will be querried'
	// 		}],
	// 		responses: {
	// 			'200': {
	// 				description: 'Stats of bulkCreate'
	// 			},
	// 			'400': {
	// 				description: 'Bad parameters'
	// 			},
	// 			'500': {
	// 				description: 'Internal server error'
	// 			}
	// 		}
	// 	}
	// };
	// swagger.paths['/utils/fileMapper/{fileId}/mapping'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'put': {
	// 		description: 'Uploads the file containing data',
	// 		operationId: 'v1_mapping',
	// 		parameters: [
	// 			{
	// 				name: 'data',
	// 				in: 'body',
	// 				description: 'Payload to validate data',
	// 				schema: {
	// 					type: 'object'
	// 				}
	// 			},
	// 			{
	// 				name: 'authorization',
	// 				in: 'header',
	// 				type: 'string',
	// 				description: 'The JWT token for req.validation'
	// 			}, {
	// 				name: 'fileId',
	// 				in: 'path',
	// 				required: true,
	// 				type: 'string',
	// 				description: 'fileId against which we db will be querried'
	// 			}],
	// 		responses: {
	// 			'200': {
	// 				description: 'Data validated against mapping'
	// 			},
	// 			'400': {
	// 				description: 'Bad parameters'
	// 			},
	// 			'500': {
	// 				description: 'Internal server error'
	// 			}
	// 		}
	// 	}
	// };



	// Was used by WF module
	// swagger.paths['/utils/fileMapper/enrich'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'put': {
	// 		description: 'Enrich the sheet data',
	// 		operationId: 'v1_enrichData',
	// 		parameters: [{
	// 			name: 'data',
	// 			in: 'body',
	// 			description: 'Payload to validate data',
	// 			schema: {
	// 				$ref: '#/definitions/enrichData'
	// 			}
	// 		}, {
	// 			name: 'authorization',
	// 			in: 'header',
	// 			type: 'string',
	// 			description: 'The JWT token for req.validation'
	// 		}],
	// 		responses: {
	// 			'200': {
	// 				description: 'Data enriched against mapping'
	// 			},
	// 			'400': {
	// 				description: 'Bad parameters'
	// 			},
	// 			'500': {
	// 				description: 'Internal server error'
	// 			}
	// 		}
	// 	}
	// };
	// swagger.paths['/utils/fileMapper/{fileId}/enrichDataForWF'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'get': {
	// 		description: 'Enrich the sheet data for Record ID',
	// 		operationId: 'v1_enrichDataForWF',
	// 		parameters: [{
	// 			name: 'page',
	// 			in: 'query',
	// 			type: 'integer',
	// 			description: 'Page number of the request'
	// 		}, {
	// 			name: 'authorization',
	// 			in: 'header',
	// 			type: 'string',
	// 			description: 'The JWT token for req.validation'
	// 		}, {
	// 			name: 'count',
	// 			in: 'query',
	// 			type: 'integer',
	// 			description: 'Number of records per page'
	// 		}, {
	// 			name: 'fileId',
	// 			in: 'path',
	// 			required: true,
	// 			type: 'string',
	// 			description: 'fileId against which we db will be querried'
	// 		}, {
	// 			name: 'operation',
	// 			in: 'query',
	// 			type: 'string',
	// 			description: 'request method',
	// 			default: 'false'
	// 		}, {
	// 			name: 'filter',
	// 			in: 'query',
	// 			type: 'string',
	// 			description: 'filter'
	// 		}],
	// 		responses: {
	// 			'200': {
	// 				description: 'Data enriched against mapping'
	// 			},
	// 			'400': {
	// 				description: 'Bad parameters'
	// 			},
	// 			'500': {
	// 				description: 'Internal server error'
	// 			}
	// 		}
	// 	}
	// };
	swagger.paths['/utils/fileMapper/{fileId}/count'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'get': {
			description: `returns count of '${config.name}'`,
			operationId: 'fileMapperCount',
			parameters: countParameters.concat({
				name: 'fileId',
				in: 'path',
				required: true,
				type: 'string',
				description: 'fileId against which we db will be querried'
			}),
			responses: {
				'200': {
					description: 'Count of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/export'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'post': {
			description: `Retrieve a list of '${config.name}'`,
			operationId: `${methodName.exportAll}`,
			parameters: config.enableSearchIndex ? JSON.parse(JSON.stringify(exportParameters)).concat([expandOption, searchOption, totalRecord]) : JSON.parse(JSON.stringify(exportParameters)).concat([expandOption, totalRecord]),
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/fileTransfers'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'get': {
			description: 'Retrieve list of bulk actions\'',
			operationId: `${methodName.exportAllDetail}`,
			parameters: JSON.parse(JSON.stringify(getParameters)),
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};

	swagger.paths['/utils/fileTransfers/count'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'get': {
			description: 'count of bulk actions\'',
			operationId: `${methodName.exportAllDetailCount}`,
			parameters: JSON.parse(JSON.stringify(getParameters)),
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/fileTransfers/{id}'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'delete': {
			description: 'Deletes a file with file id',
			operationId: `${methodName.exportAllDetailDelete}`,
			parameters: [{
				name: 'id',
				in: 'path',
				type: 'string',
				required: true,
				description: 'Id of file',
			}, {
				name: 'authorization',
				in: 'header',
				type: 'string',
				description: 'The JWT token for req.validation'
			}],
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/fileTransfers/{fileId}/readStatus'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'put': {
			description: 'Updates File Read Status',
			operationId: 'exportUpdateReadStatus',
			parameters: [{
				name: 'fileId',
				in: 'path',
				type: 'string',
				required: true,
				description: 'Id of file',
			}, {
				name: 'authorization',
				in: 'header',
				type: 'string',
				description: 'The JWT token for req.validation'
			}, {
				name: 'data',
				in: 'body',
				description: 'Payload with read status',
				schema: {
					properties: {
						'isRead': {
							'type': 'boolean',
						}
					}
				}
			}],
			responses: {
				'200': {
					description: 'File read status updated'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	swagger.paths['/utils/aggregate'] = {
		'x-swagger-router-controller': `${methodName.controller}`,
		'post': {
			description: 'runs aggregate query',
			operationId: 'v1_aggregate',
			parameters: [{
				name: 'authorization',
				in: 'header',
				type: 'string',
				description: 'The JWT token for req.validation'
			}, {
				name: 'data',
				in: 'body',
				description: 'Payload to aggregate',
				schema: {
					'type': 'array',
					'items': {
						'type': 'object'
					}
				}
			}],
			responses: {
				'200': {
					description: 'List of the entites'
				},
				'400': {
					description: 'Bad parameters'
				},
				'500': {
					description: 'Internal server error'
				}
			}
		}
	};
	// swagger.paths['/utils/hrefUpdate'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'put': {
	// 		description: 'Update url of outgoing relations',
	// 		operationId: 'v1_updateHref',
	// 		parameters: [{
	// 			name: 'data',
	// 			in: 'body',
	// 			description: 'Payload to update href',
	// 			schema: {
	// 				'type': 'object'
	// 			}
	// 		}],
	// 		responses: {
	// 			'200': {
	// 				description: 'List of the entites'
	// 			},
	// 			'400': {
	// 				description: 'Bad parameters'
	// 			},
	// 			'500': {
	// 				description: 'Internal server error'
	// 			}
	// 		}
	// 	}
	// };
	// swagger.paths['/utils/health/live'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'get': {
	// 		description: 'Healthcheck API for service',
	// 		operationId: `${methodName.healthCheck}`,
	// 		responses: {
	// 			'200': {
	// 				description: 'Success'
	// 			},
	// 			'400': {
	// 				description: 'Error'
	// 			}
	// 		}
	// 	}
	// };

	// swagger.paths['/utils/health/ready'] = {
	// 	'x-swagger-router-controller': `${methodName.controller}`,
	// 	'get': {
	// 		description: 'Healthcheck API for service',
	// 		operationId: `${methodName.readinessCheck}`,
	// 		responses: {
	// 			'200': {
	// 				description: 'Success'
	// 			},
	// 			'400': {
	// 				description: 'Error'
	// 			}
	// 		}
	// 	}
	// };
	return jsyaml.dump(swagger);
}

module.exports.generateYaml = generateYaml;