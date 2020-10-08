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

let _ = require("lodash");

function isString(val) {
    return val && val.constructor.name === 'String';
};

function createRegexp(str) {
    if (str.charAt(0) === '/' &&
        str.charAt(str.length - 1) === '/') {
        var text = str.substr(1, str.length - 2).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
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


module.exports.validateAggregation = validateAggregation;
module.exports.parseFilter = parseFilter;