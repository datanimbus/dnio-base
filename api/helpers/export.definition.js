const definition = {
    _metadata: {
        type: {
            version: {
                release: {
                    type: 'Number'
                }
            }
        },
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
    fileName: {
        type: 'String'
    },
    data: {
        type: 'Object'
    },
    status: {
        type: 'String',
        enum: ['Pending', 'Ready', 'Error']
    }
};
module.exports.definition = definition;