const mongoose = require('mongoose');
const _ = require('lodash');

function MakeSchema(definition, options) {
	if (definition) {
		const temp = {
			type: {
				lastUpdated: {
					type: 'Date',
					default: Date.now
				},
				createdAt: {
					type: 'Date',
					default: Date.now
				},
				deleted: {
					type: 'Boolean',
					default: false
				},
				version: {
					type: {
						document: {
							type: 'Number',
							default: 0
						}
					}
				}
			},
			default: () => {
				return {
					createdAt: Date.now(),
					lastUpdated: Date.now(),
					deleted: false,
					version: {
						document: 0
					}
				};
			}
		};
		if (!definition._metadata) {
			definition._metadata = {};
		}
		definition._metadata = _.merge(temp, definition._metadata);
		definition._expireAt = {
			type: Date
		};
		if (options) {
			return new mongoose.Schema(definition, options);
		}
		return new mongoose.Schema(definition);
	}
}

/**
 * 
 * @param {*} [options]
 */
function metadataPlugin() {
	return function (schema) {
		// schema.add({
		// 	_expireAt: {
		// 		type: Date,
		// 	},
		// 	_metadata: {
		// 		deleted: {
		// 			type: Boolean,
		// 			default: false
		// 		},
		// 		lastUpdated: {
		// 			type: Date,
		// 			default: Date.now()
		// 		},
		// 		createdAt: {
		// 			type: Date
		// 		},
		// 		version: {
		// 			type: Object
		// 		}
		// 	}
		// });
		schema.index({ '_expireAt': 1 }, { expireAfterSeconds: 0 });
		schema.index({ '_metadata.lastUpdated': 1 }, { sparse: true });
		schema.index({ '_metadata.createdAt': 1 }, { sparse: true });
		schema.pre('save', function (next) {
			const self = this;
			if (!self._metadata) {
				self._metadata = {};
			}
			self._metadata.deleted = false;
			if (!self._metadata.version) {
				self._metadata.version = {};
			}
			if (self._metadata.version) {
				self._metadata.version.release = process.env.RELEASE || 'dev';
			}
			if (!self._metadata.version.document) {
				self._metadata.version.document = 0;
			}
			self._metadata.version.document++;
			if (self.isNew) {
				self._metadata.createdAt = new Date();
			}
			self._wasNew = self.isNew;
			self._metadata.lastUpdated = new Date();
			self.markModified('_metadata');
			next();
		});

		schema.pre('insertMany', function (next, docs) {
			if (docs && docs.length > 0) {
				docs.forEach((doc) => {
					if (!doc._metadata) {
						doc._metadata = {};
					}
					doc._metadata.deleted = false;
					if (!doc._metadata.version) {
						doc._metadata.version = {};
					}
					if (doc._metadata.version) {
						doc._metadata.version.release = process.env.RELEASE || 'dev';
					}
					if (!doc._metadata.version.document) {
						doc._metadata.version.document = 0;
					}
					doc._metadata.version.document++;
					if (doc.isNew) {
						doc._metadata.createdAt = new Date();
					}
					doc._wasNew = true;
					doc._metadata.lastUpdated = new Date();
				});
			}
			next();
		});
	};
}



function generateId(prefix, counterName, suffix, padding, counter) {
	return async function (next) {
		if (this._id) {
			return next();
		}
		prefix = prefix ? prefix : '';
		suffix = suffix ? suffix : '';
		let id = null;
		if (counter || counter === 0) {
			const doc = await getCount(counterName);
			let nextNo = padding ? Math.pow(10, padding) + doc.next : doc.next;
			nextNo = (nextNo || 0).toString();
			if (padding && parseInt(nextNo.substr(0, 1)) > 1) {
				throw new Error('length of _id is exceeding counter');
			}
			id = padding ? prefix + nextNo.substr(1) + suffix : prefix + nextNo + suffix;
		} else if (padding) {
			id = prefix + rand(padding) + suffix;
		} else {
			const doc = await getCount(counterName);
			id = prefix + doc.next;
		}
		this._id = id;
		next();
	};
}


async function getCount(counterName) {
	const authorDB = global.authorDB;
	const collection = authorDB.collection('counters');
	return ((await collection.findOneAndUpdate({ _id: counterName }, { $inc: { next: 1 } }, { upsert: true })).value || 0);
}


function rand(_i) {
	var i = Math.pow(10, _i - 1);
	var j = Math.pow(10, _i) - 1;
	return ((Math.floor(Math.random() * (j - i + 1)) + i));
}


module.exports.generateId = generateId;
module.exports.metadataPlugin = metadataPlugin;
module.exports.MakeSchema = MakeSchema;