const _ = require('lodash');
 var definition = {
    "name": {
        "type": "String"
    },
    "attachment": {
        "type": {
            "_id": {
                "type": "String"
            },
            "filename": {
                "type": "String"
            },
            "contentType": {
                "type": "String"
            },
            "length": {
                "type": "Number"
            },
            "chunkSize": {
                "type": "Number"
            },
            "uploadDate": {
                "type": "Date"
            },
            "md5": {
                "type": "String"
            },
            "metadata": {
                "filename": {
                    "type": "String"
                }
            }
        }
    },
    "_id": {
        "type": "String"
    },
    "_expireAt": {
        "type": "Date"
    },
    "_metadata": {
        "type": {
            "version": {
                "type": {
                    "service": {
                        "type": "Number",
                        "default": 0
                    },
                    "release": {
                        "type": "String",
                        "default": 0
                    }
                }
            },
            "filemapper": {
                "type": "String"
            },
            "workflow": {
                "type": "String"
            }
        }
    }
};
module.exports.definition=definition;