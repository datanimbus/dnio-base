const _ = require('lodash');
 var definition = {
    "name": {
        "type": "String"
    },
    "age": {
        "type": "Number",
        "validate": [
            {
                "validator": function anonymous(value
) {

					if(!value) return true;
                    return Number.isFinite(value);
                    
}
            }
        ]
    },
    "date": {
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
    "boolean": {
        "type": "String"
    },
    "location": {
        "type": {
            "geometry": {
                "type": {
                    "type": "String"
                },
                "coordinates": {
                    "type": [
                        {
                            "type": "Number"
                        }
                    ]
                }
            },
            "formattedAddress": {
                "type": "String"
            },
            "town": {
                "type": "String"
            },
            "district": {
                "type": "String"
            },
            "state": {
                "type": "String"
            },
            "country": {
                "type": "String"
            },
            "pincode": {
                "type": "String"
            },
            "userInput": {
                "type": "String"
            }
        }
    },
    "file": {
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
    "user": {
        "type": {
            "_id": {
                "type": "String"
            }
        },
        "default": {
            "_id": "meghana@appveen.com"
        }
    },
    "password": {
        "type": {
            "value": {
                "type": "String"
            },
            "checksum": {
                "type": "String"
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
                        "type": "Number",
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