const _ = require('lodash');

const config = require('../../config');

const logger = global.logger;

function IsString(val) {
	return val && val.constructor.name === 'String';
}

function CreateRegexp(str) {
	if (str.charAt(0) === '/' &&
		str.charAt(str.length - 1) === '/') {
		var text = str.substr(1, str.length - 2).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
		return new RegExp(text, 'i');
	} else {
		return str;
	}
}
function IsArray(arg) {
	return arg && arg.constructor.name === 'Array';
}

function IsObject(arg) {
	return arg && arg.constructor.name === 'Object';
}

function ResolveArray(arr) {
	for (var x = 0; x < arr.length; x++) {
		if (IsObject(arr[x])) {
			arr[x] = FilterParse(arr[x]);
		} else if (IsArray(arr[x])) {
			arr[x] = ResolveArray(arr[x]);
		} else if (IsString(arr[x])) {
			arr[x] = CreateRegexp(arr[x]);
		}
	}
	return arr;
}

function FilterParse(filterParsed) {
	for (var key in filterParsed) {
		if (IsString(filterParsed[key])) {
			filterParsed[key] = CreateRegexp(filterParsed[key]);
		} else if (IsArray(filterParsed[key])) {
			filterParsed[key] = ResolveArray(filterParsed[key]);
		} else if (IsObject(filterParsed[key])) {
			filterParsed[key] = FilterParse(filterParsed[key]);
		}
	}
	return filterParsed;
}
let e = {};
e.index = function (req, model) {
	let reqParams = Object.keys(req.swagger.params).reduce((prev, curr) => {
		prev[curr] = req.swagger.params[curr].value;
		return prev;
	}, {});
	var filter = reqParams['filter'] ? reqParams.filter : {};
	var sort = reqParams['sort'] ? {} : {
		'_metadata.lastUpdated': -1
	};
	reqParams['sort'] ? reqParams.sort.split(',').map(el => el.split('-').length > 1 ? sort[el.split('-')[1]] = -1 : sort[el.split('-')[0]] = 1) : null;
	var select = reqParams['select'] ? reqParams.select.split(',') : [];
	var page = reqParams['page'] ? reqParams.page : 1;
	var count = reqParams['count'] ? reqParams.count : 10;
	var search = reqParams['search'] ? reqParams.search : null;
	var skip = count * (page - 1);
	if (typeof filter === 'string') {
		try {
			filter = JSON.parse(filter);
			filter = FilterParse(filter);
		} catch (err) {
			logger.error('Failed to parse filter :' + err);
			filter = {};
		}
	}
	filter = _.assign({}, filter);
	filter['_metadata.deleted'] = !config.permanentDelete;
	if (search) {
		filter['$text'] = { '$search': search };
	}
	var query = model.find(filter);
	query.lean();
	if (select.length || select.length) {
		var union = select.concat(select);
		query.select(union.join(' '));
	}
	if (count == -1) query.sort(sort);
	else query.skip(skip).limit(count).sort(sort);
	return query.exec();
};
e.count = function (req, model) {
	let reqParams = Object.keys(req.swagger.params).reduce((prev, curr) => {
		prev[curr] = req.swagger.params[curr].value;
		return prev;
	}, {});
	var filter = reqParams['filter'] ? reqParams.filter : {};

	if (typeof filter === 'string') {
		try {
			filter = JSON.parse(filter);
			filter = FilterParse(filter);
		} catch (err) {
			logger.error('Failed to parse filter :' + err);
			filter = {};
		}
	}
	filter = _.assign({}, filter);
	filter['_metadata.deleted'] = !config.permanentDelete;
	var query = model.find(filter).count();
	query.lean();
	return query.exec();
};

module.exports = e;