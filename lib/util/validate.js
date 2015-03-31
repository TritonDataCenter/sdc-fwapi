/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Validation functions
 */

var assert = require('assert-plus');
var constants = require('./constants');
var mod_arr = require('./array');
var mod_err = require('../errors');
var util = require('util');



// --- Exports



function validateFields(name, val) {
    var field;
    var fields;
    var unknown = [];

    if (typeof (val) !== 'string' && !util.isArray(val)) {
        throw mod_err.invalidParamSubErr(name, 'must be an array');
    }

    fields = mod_arr.splitToArray(val);

    for (var f in fields) {
        field = fields[f];

        if (typeof (field) !== 'string') {
            throw mod_err.invalidParamSubErr(name,
                'must be an array of strings');
        }

        if (constants.PARSED_FIELDS.indexOf(field) === -1) {
            unknown.push(field);
        }
    }

    if (unknown.length !== 0) {
        throw mod_err.invalidParamSubErr(name,
            util.format('unknown field%s: %s',
                unknown.length === 1 ? '' : 's',
                unknown.join(', ')));
    }

    return fields;
}


function validateParams(validators, params) {
    assert.object(validators, 'validators');
    assert.object(params, 'params');

    var errs = [];
    var results = {};

    // XXX: add required

    for (var v in validators.optional) {
        if (!params.hasOwnProperty(v)) {
            continue;
        }

        try {
            results[v] = validators.optional[v](v, params[v]);
        } catch (valErr) {
            errs.push(valErr);
        }
    }

    if (errs.length !== 0) {
        throw new mod_err.InvalidParamsError(
            mod_err.INVALID_MSG, errs.map(function (e) {
                return {
                    code: e.code,
                    field: e.field,
                    message: e.message
                };
            }));
    }

    return results;
}


module.exports = {
    fields: validateFields,
    params: validateParams
};
