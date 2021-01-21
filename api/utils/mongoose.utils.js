
/**
 * 
 * @param {*} [options]
 */
function metadataPlugin(options) {
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
    }
}

module.exports.metadataPlugin = metadataPlugin;