const definition = {
	filename: {
		type: 'String',
		required: true,
	},
	contentType: {
		type: 'String',
		required: false
	},
	md5: {
		type: 'String',
		required: true
	},
	length: {
		type: 'Number',
		required: true
	},
	uploadDate: {
		type: 'Date'
	},
	metadata: {
		filename: {
			type: 'String'
		}
	}
};
module.exports.definition = definition;