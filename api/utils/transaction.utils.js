const request = require('../utils/got-request-wrapper');

const config = require('../../config');

function transferToTransaction(req, res) {
	const payload = [];
	if (req.path.indexOf('bulkDelete') > -1) {
		if (req.body.ids || req.query.ids) {
			const ids = req.query.ids || req.body.ids;
			ids.forEach(id => {
				payload.push({
					operation: 'DELETE',
					dataService: {
						app: config.app,
						name: config.serviceName
					},
					data: {
						_id: id
					}
				});
			});
		}
	} else if (req.path.indexOf('bulkUpdate') > -1) {
		const ids = req.query.id.split(',');
		ids.forEach(id => {
			const data = JSON.parse(JSON.stringify(req.body));
			data._id = id;
			payload.push({
				operation: 'PUT',
				upsert: req.query.upsert,
				dataService: {
					app: config.app,
					name: config.serviceName
				},
				data
			});
		});
	} else if (req.method === req.method) {
		if (Array.isArray(req.body)) {
			req.body.forEach(item => {
				payload.push({
					operation: req.method,
					dataService: {
						app: config.app,
						name: config.serviceName
					},
					data: item
				});
			});
		} else {
			payload.push({
				operation: req.method,
				dataService: {
					app: config.app,
					name: config.serviceName
				},
				data: req.body
			});
		}
	} else if (req.method === 'PUT') {
		req.body._id = req.params.id;
		payload.push({
			operation: req.method,
			upsert: req.query.upsert,
			dataService: {
				app: config.app,
				name: config.serviceName
			},
			data: req.body
		});
	} else if (req.method === 'DELETE') {
		payload.push({
			operation: req.method,
			dataService: {
				app: config.app,
				name: config.serviceName
			},
			data: {
				_id: req.params.id
			}
		});
	} else {
		throw new Error('INVALID_HTTP_METHOD_FOR_TRANSACTION');
	}
	return request.post(config.baseUrlCOMMON, {
		method: 'POST',
		body: payload,
		json: true,
		headers: req.headers
	}, function (err, reqRes) {
		if (err) {
			res.status(500).json(err);
		} else {
			res.status(reqRes.statusCode).json(reqRes.body);
		}
	});
}


module.exports.transferToTransaction = transferToTransaction;