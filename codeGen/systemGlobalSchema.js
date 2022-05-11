module.exports = {
	'Geojson': {
		'type': 'Object',
		'definition': [
			{
				'type': 'Object',
				'key': 'geometry',
				'definition': [
					{
						'type': 'String',
						'key': 'type',
						'enum': ['Point']
					},
					{
						'type': 'Array',
						'key': 'coordinates',
						'definition': [
							{
								'type': 'Number',
								'key': '_self'
							}
						]
					}
				]
			},
			{
				'type': 'String',
				'key': 'formattedAddress'
			},
			{
				'type': 'String',
				'key': 'town'
			},
			{
				'type': 'String',
				'key': 'district'
			},
			{
				'type': 'String',
				'key': 'state'
			},
			{
				'type': 'String',
				'key': 'country'
			},
			{
				'type': 'String',
				'key': 'pincode'
			},
			{
				'type': 'String',
				'key': 'userInput'
			}
		]
	},
	'File': {
		'type': 'Object',
		'definition': [
			{
				'type': 'String',
				'key': '_id'
			},
			{
				'type': 'String',
				'key': 'filename'
			},
			{
				'type': 'String',
				'key': 'contentType'
			},
			{
				'type': 'Number',
				'key': 'length'
			},
			{
				'type': 'Number',
				'key': 'chunkSize'
			},
			{
				'type': 'Date',
				'key': 'uploadDate'
			},
			{
				'type': 'String',
				'key': 'md5'
			},
			{
				'type': 'Object',
				'key': 'metadata',
				'definition': [
					{
						'type': 'String',
						'key': 'filename'
					}
				]
			}
		]
	},
	'Relation': {
		'type': 'Object',
		'definition': [
			{
				'type': 'String',
				'key': '_id',
				'properties': {
					'name': '_id',
					'_typeChanged': 'String'
				}
			},
			{
				'type': 'String',
				'key': '_href',
				'properties': {
					'name': '_href',
					'_typeChanged': 'String'
				}
			}
		]
	},
	'User': {
		'type': 'User',
		'definition': [
			{
				'type': 'String',
				'key': '_id',
				'properties': {
					'name': '_id',
				}
			}
		]
	},
	'SecureText': {
		'type': 'Object',
		'definition': [
			{
				'type': 'String',
				'key': 'value',
				'properties': {
					'name': 'value',
					'_typeChanged': 'String'
				}
			},
			{
				'type': 'String',
				'key': 'checksum',
				'properties': {
					'name': 'checksum',
					'_typeChanged': 'String'
				}
			}
		]
	},
	'Date': {
		'type': 'Object',
		'definition': [
			{
				'type': 'String',
				'key': 'rawData'
			},
			{
				'type': 'Date',
				'key': 'tzData'
			},
			{
				'type': 'String',
				'key': 'tzInfo'
			},
			{
				'type': 'Date',
				'key': 'utc'
			},
			{
				'type': 'Number',
				'key': 'unix'
			}
		]
	}
};