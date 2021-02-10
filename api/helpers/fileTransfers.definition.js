var definition = {
	user: {
		type: 'String',
	},
	_id: {
		type: 'String'
	},
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
	status: {
		type: 'String',
	},
	message: {
		type: 'String',
	},
	fileName: {
		type: 'String',
	},
	headers: {
		type: 'Object',
	},
	createdCount: {
		type: 'Number',
	},
	updatedCount: {
		type: 'Number',
	},
	duplicateCount: {
		type: 'Number',
	},
	conflictCount: {
		type: 'Number',
	},
	validCount: {
		type: 'Number',
	},
	errorCount: {
		type: 'Number'
	},
	type: {
		type: 'String',
	},
	isRead: {
		type: 'Boolean',
	}
};
module.exports.definition = definition;