let invalidAggregationKeys = [
	'$graphLookup',
	'$lookup',
	'$merge',
	'$out',
	'$currentOp',
	'$collStats',
	'$indexStats',
	'$planCacheStats',
	'$listLocalSessions',
	'$listSessions'
];

let logger = global.logger;

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

function validateAggregation(body) {
	if (!body) return true;
	if (Array.isArray(body)) {
		return body.every(_b => validateAggregation(_b));
	}
	if (body.constructor == {}.constructor) {
		return Object.keys(body).every(_k => {
			let flag = invalidAggregationKeys.indexOf(_k) === -1;
			if (!flag) throw new Error(_k + ' is restricted.');
			return flag && validateAggregation(body[_k]);
		});
	}
	return true;
}

const { flatten } = require('@appveen/utils/objectUtils');
let _ = require('lodash');

function isString(val) {
	return val && val.constructor.name === 'String';
}

function createRegexp(str) {
	if (str.charAt(0) === '/' &&
		str.charAt(str.length - 1) === '/') {
		var text = str.substr(1, str.length - 2).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
		return new RegExp(text, 'i');
	} else {
		return str;
	}
}
function isArray(arg) {
	return arg && arg.constructor.name === 'Array';
}

function isObject(arg) {
	return arg && arg.constructor.name === 'Object';
}

function resolveArray(arr) {
	for (var x = 0; x < arr.length; x++) {
		if (isObject(arr[x])) {
			arr[x] = parseFilter(arr[x]);
		} else if (isArray(arr[x])) {
			arr[x] = resolveArray(arr[x]);
		} else if (isString(arr[x])) {
			arr[x] = createRegexp(arr[x]);
		}
	}
	return arr;
}

function parseFilter(filterParsed) {
	for (var key in filterParsed) {
		if (isString(filterParsed[key])) {
			filterParsed[key] = createRegexp(filterParsed[key]);
		} else if (isArray(filterParsed[key])) {
			filterParsed[key] = resolveArray(filterParsed[key]);
		} else if (isObject(filterParsed[key])) {
			filterParsed[key] = parseFilter(filterParsed[key]);
		}
	}
	return filterParsed;
}

function cursor(req, model) {
	let reqParams = req.query;// Object.keys(req.swagger.params).reduce((prev, curr) => {
	// 	prev[curr] = req.swagger.params[curr].value;
	// 	return prev;
	// }, {});
	var filter = reqParams['filter'] ? reqParams.filter : {};
	var sort = reqParams['sort'] ? {} : {
		'_metadata.lastUpdated': -1
	};

	reqParams['sort'] ? reqParams.sort.split(',').map(el => el.split('-').length > 1 ? sort[el.split('-')[1]] = -1 : sort[el.split('-')[0]] = 1) : null;
	var select = reqParams['select'] ? reqParams.select.split(',') : [];
	var skip = reqParams['skip'] ? reqParams.skip : 0;
	var batchSize = reqParams['batchSize'] ? reqParams.batchSize : 500;
	var search = reqParams['search'] ? reqParams.search : null;
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
	if (search) {
		filter['$text'] = { '$search': search };
	}
	var query = model.find(filter).skip(skip).sort(sort);
	query.lean();
	if (select.length || select.length) {
		let obj = {};
		select.forEach(key => {
			_.set(obj, key, '');
		});
		const t = flatten(obj);
		select = Object.keys(t);
		query.select(select.join(' '));
	}
	return query.batchSize(batchSize).cursor();
}

function simulateDocs(dataArr, generateId, _req, operation) {
	logger.debug(dataArr, generateId, _req, operation);
	// TBD
}

module.exports = {
	validateAggregation,
	parseFilter,
	cursor,
	simulateDocs
};