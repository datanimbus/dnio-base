var definition = {
	name: {
		type: 'String'
	},
	email: {
		type: 'String',
		validate: [
			{
				validator: function anonymous(value
				) {

					if (value == null) return true;
					if (value.length == 0) return false;
					var re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/i;

					if (Array.isArray(value)) {

						let flag = true;
						value.forEach(e => {

							flag = flag && re.test(e);
						});
						return flag;
					} else {
						return re.test(value);
					}
				},
				msg: 'email is not a valid email'
			}
		]
	},
	password: {
		type: {
			value: {
				type: 'String'
			},
			checksum: {
				type: 'String'
			}
		}
	},
	contactNo: {
		type: 'Number',
		validate: [
			{
				validator: function anonymous(value
				) {

					if (!value) return true;
					return Number.isFinite(value);

				}
			}
		]
	},
	alternateNos: {
		type: [
			{
				type: 'Number',
				validate: [
					{
						validator: function anonymous(value
						) {

							if (!value) return true;
							return Number.isFinite(value);

						}
					}
				]
			}
		]
	},
	location: {
		type: {
			geometry: {
				type: {
					type: 'String'
				},
				coordinates: {
					type: [
						{
							type: 'Number'
						}
					]
				}
			},
			formattedAddress: {
				type: 'String'
			},
			town: {
				type: 'String'
			},
			district: {
				type: 'String'
			},
			state: {
				type: 'String'
			},
			country: {
				type: 'String'
			},
			pincode: {
				type: 'String'
			},
			userInput: {
				type: 'String'
			}
		}
	},
	address: {
		type: {
			_id: {
				type: 'String'
			},
			_href: {
				type: 'String'
			}
		}
	},
	tempAddress: {
		street: {
			type: 'String'
		},
		city: {
			type: 'String'
		},
		state: {
			type: 'String'
		},
		pincode: {
			type: 'Number',
			validate: [
				{
					validator: function anonymous(value
					) {

						if (!value) return true;
						return Number.isFinite(value);

					}
				}
			]
		}
	},
	prevAddress: {
		type: [
			{
				street: {
					type: 'String'
				},
				city: {
					type: 'String'
				},
				state: {
					type: 'String'
				},
				pincode: {
					type: 'Number',
					validate: [
						{
							validator: function anonymous(value
							) {

								if (!value) return true;
								return Number.isFinite(value);

							}
						}
					]
				}
			}
		]
	},
	resume: {
		type: {
			_id: {
				type: 'String'
			},
			filename: {
				type: 'String'
			},
			contentType: {
				type: 'String'
			},
			length: {
				type: 'Number'
			},
			chunkSize: {
				type: 'Number'
			},
			uploadDate: {
				type: 'Date'
			},
			md5: {
				type: 'String'
			},
			metadata: {
				filename: {
					type: 'String'
				}
			}
		}
	},
	active: {
		type: 'Boolean'
	},
	dateOfBirth: {
		type: 'Date'
	},
	userId: {
		type: 'String'
	},
	appUser: {
		type: {
			_id: {
				type: 'String'
			}
		}
	},
	_id: {
		type: 'String'
	},
	_expireAt: {
		type: 'Date'
	},
	_metadata: {
		type: {
			version: {
				type: {
					service: {
						type: 'Number',
						default: 0
					},
					release: {
						type: 'Number',
						default: 0
					}
				}
			},
			filemapper: {
				type: 'String'
			},
			workflow: {
				type: 'String'
			}
		}
	}
};
module.exports.definition = definition;