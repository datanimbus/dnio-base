const _ = require('lodash');
 var definition = {
    "name": {
        "default": null,
        "type": "String"
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