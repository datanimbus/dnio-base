
/**
 * 
 * @param {*} [options]
 */
function metadataPlugin() {
	return function (schema) {
		schema.add({
			_metadata: {
				type: {
					deleted: {
						type: Boolean,
						default: false
					},
					lastUpdated: {
						type: Date,
						default: Date.now()
					},
					createdAt: {
						type: Date
					},
					version: {
						type: Object
					}
				},
			}
		});
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
			if (self.isNew) {
				self._metadata.createdAt = new Date();
			}
			self._wasNew = self.isNew;
			self._metadata.lastUpdated = new Date();
			self.markModified('_metadata');
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