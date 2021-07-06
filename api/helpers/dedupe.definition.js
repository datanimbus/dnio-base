const definition = {
	_metadata: {
		createdAt: {
			type: 'Date'
		},
		lastUpdated: {
			type: 'Date'
		},
		deleted: {
			type: 'Boolean'
		}
	},
	user: {
		type: 'String',
		required: true
	},
	criteria: {
		type: 'Object',
		required: true
	},
	dedupeId: {
		type: 'String',
		required: true
	},
	docs: {
		type: ['Object']
	},
	docsCount: {
		type: 'Number',
		required: true
	},
	result: {
		type: 'String',
		enum: ['SUCCESS', 'FAILED']
	},
	action: {
		type: 'String',
		enum: ['PENDING', 'MARK_ONE', 'CREATE_NEW', 'UPDATE_ONE', 'DISCARD'],
		default: 'PENDING'
	},
	newDoc: {
		type: 'Object'
	},
	remarks: {
		type: 'String'
	},
	errMessage: {
		type: 'String'
	},
};
module.exports.definition = definition;