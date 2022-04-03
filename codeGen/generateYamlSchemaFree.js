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

const bulkShowParameters = [
	{
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
	},
	{
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
	}
];

const showParameters = [
	{
		name: 'select',
		in: 'query',
		type: 'string',
		description: 'Comma seperated fields to be displayed'
	},
	{
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
	}
];

const hookParameters = [
	{
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
	}
];

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
	}
];

const countParameters = [
	{
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
	}
];

const exportParameters = [
	{
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
	}
];

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
	//obj.math = `v1_${name}Math`;
	obj.destroy = `v1_${name}Destroy`;
	obj.count = `v1_${name}Count`;
	obj.bulkShow = `v1_${name}BulkShow`;
	//obj.securedFields = `v1_${name}SecuredFields`;
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
				description: `Payload to create a '${config.name}'`
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
				description: `Payload to validate '${config.name}'`
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
				description: `Payload to update a '${config.name}'`
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

	return jsyaml.dump(swagger);
}

module.exports.generateYamlSchemaFree = generateYaml;