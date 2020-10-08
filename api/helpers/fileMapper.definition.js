const definition = {
    fileId: {
        type: 'String',
        required: true,
    },
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
    sNo: {
        type: 'Number'
    },
    data: {
        type: 'Object'
    },
    conflict: {
        type: 'Boolean',
        default: false
    },
    message: {
        type: 'String'
    },
    errorSource: {
        type: 'String'
    },
    status: {
        type: 'String',
        enum: ['Pending', 'Validated', 'Created', 'Duplicate', 'Error', 'Ignored', 'Updated']
    }
};
module.exports.definition = definition;