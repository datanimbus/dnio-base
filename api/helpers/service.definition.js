const _ = require('lodash');
 var definition = {
    "studyId": {
        "type": "String"
    },
    "siteId": {
        "type": "String"
    },
    "subjectId": {
        "type": "String"
    },
    "visitId": {
        "type": "String"
    },
    "visitDate": {
        "type": {
            "rawData": {
                "type": "String"
            },
            "tzData": {
                "type": "Date"
            },
            "tzInfo": {
                "type": "String"
            },
            "utc": {
                "type": "Date"
            },
            "unix": {
                "type": "Number"
            }
        }
    },
    "visitRepeatKey": {
        "type": "String"
    },
    "formId": {
        "type": "String"
    },
    "formRepeatKey": {
        "type": "String"
    },
    "itemGroupId": {
        "type": "String"
    },
    "itemGroupRowId": {
        "type": "String"
    },
    "itemId": {
        "type": "String"
    },
    "itemValue": {
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