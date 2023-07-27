const router = require('express').Router();
const log4js = require('log4js');

const specialFields = require('../utils/special-fields.utils');

const logger = log4js.getLogger(global.loggerName);

router.get('/hasAccess', async (req, res) => {
	try {
		let type = req.query.type.split(',');
		let counter = 0;

		if (type.includes('GET')) {
			if (specialFields.hasPermissionForGET(req, (req?.user?.appPermissions || []))) {
				counter += 1;
			}
		}
		if (type.includes('PUT')) {
			if (specialFields.hasPermissionForPUT(req, (req?.user?.appPermissions || []))) {
				counter += 1;
			}
		}
		if (type.includes('POST')) {
			if (specialFields.hasPermissionForPOST(req, (req?.user?.appPermissions || []))) {
				counter += 1;
			}
		}
		if (type.includes('DELETE')) {
			if (specialFields.hasPermissionForDELETE(req, (req?.user?.appPermissions || []))) {
				counter += 1;
			}
		}

		return res.status(counter == type.length ? 200 : 400).json({ permission: counter == type.length ? true : false });
	} catch (err) {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	}
});



module.exports = router;