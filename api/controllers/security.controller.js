const router = require('express').Router();
const log4js = require('log4js');

const secUtils = require('../utils/security.utils');
const specialFields = require('../utils/special-fields.utils');

const logger = log4js.getLogger(global.loggerName);

router.post('/decrypt', async (req, res) => {
	try {
		if (!(specialFields.hasPermissionForGET(req, req.user.appPermissions))) {
			return res.status(403).json({
				message: 'You don\'t have permission to decrypt records',
			});
		}
		const data = req.body.data;
		const decryptedText = await secUtils.decryptText(data);
		res.status(200).json({ data: decryptedText });
	} catch (err) {
		logger.error(err);
		res.status(500).json({
			message: err.message
		});
	}
});

module.exports = router;