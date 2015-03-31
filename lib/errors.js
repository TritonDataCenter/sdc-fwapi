/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Error classes and helpers
 */

var assert = require('assert-plus');
var restify = require('restify');
var util = require('util');



// --- Globals



var INVALID_MSG = 'Invalid parameters';



// --- Error classes



/**
 * Base class for item already exists errors
 */
function ExistsError(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.message, 'opts.message');
    assert.string(opts.name, 'opts.name');
    assert.arrayOfObject(opts.errors, 'opts.errors');

    restify.RestError.call(this, {
            restCode: 'InvalidParameters',
            statusCode: 422,
            message: opts.message,
            body: {
                code: util.format('%sExistsError', opts.name),
                message: opts.message,
                errors: opts.errors
            }
    });

    this.name = 'InvalidParamsError';
}

util.inherits(ExistsError, restify.RestError);


/**
 * Base class for invalid / missing parameter errors
 */
function InvalidParamsError(message, errors) {
    assert.string(message, 'message');
    assert.arrayOfObject(errors, 'errors');

    restify.RestError.call(this, {
            restCode: 'InvalidParameters',
            statusCode: 422,
            message: message,
            body: {
                code: 'InvalidParameters',
                message: message,
                errors: errors
            }
    });

    this.name = 'InvalidParamsError';
}

util.inherits(InvalidParamsError, restify.RestError);


/**
 * Base class for permission denied error
 */
function PermissionDeniedError(message, errors) {
    assert.string(message, 'message');
    assert.arrayOfObject(errors, 'errors');

    restify.RestError.call(this, {
            restCode: 'Forbidden',
            statusCode: 403,
            message: message,
            body: {
                code: 'Forbidden',
                message: message,
                errors: errors
            }
    });

    this.name = 'PermissionDeniedError';
}

util.inherits(PermissionDeniedError, restify.RestError);



// --- Functions for building elements in a response's errors array



/*
 * Error response for duplicate parameters
 */
function duplicateParam(field, message) {
    assert.string(field, 'field');

    return {
        field: field,
        code: 'Duplicate',
        message: message || 'Already exists'
    };
}


/**
 * Error response for invalid parameters
 */
function invalidParam(field, message) {
    assert.string(field, 'field');

    return {
        field: field,
        code: 'InvalidParameter',
        message: message || 'Invalid parameter'
    };
}


/**
 * A wrapper error class for the invalidParam error response above
 */
function invalidParamSubErr(param, message) {
    var subErr = new Error(message);
    subErr.code = 'InvalidParameter';
    subErr.field = param;

    return subErr;
}


/**
 * Error response for missing parameters
 */
function missingParam(field, message) {
    assert.string(field, 'field');

    return {
        field: field,
        code: 'MissingParameter',
        message: message || 'Missing parameter'
    };
}


/**
 * Returns an "already exists" error
 */
function createExistsErr(name, field) {
    var lcName = name.toLowerCase();
    return new ExistsError({
        message: util.format('%s already exists', lcName),
        name: name,
        errors: [ duplicateParam(field) ]
    });
}


/**
 * Returns an "invalid parameter" error
 */
function invalidParamErr(name, field) {
    return new InvalidParamsError(INVALID_MSG,
        [ invalidParam(field, 'Invalid ' + name) ]);
}



module.exports = {
    ExistsError: ExistsError,
    createExistsErr: createExistsErr,
    duplicateParam: duplicateParam,
    INVALID_MSG: INVALID_MSG,
    invalidParam: invalidParam,
    invalidParamErr: invalidParamErr,
    invalidParamSubErr: invalidParamSubErr,
    InvalidParamsError: InvalidParamsError,
    missingParam: missingParam,
    PermissionDeniedError: PermissionDeniedError
};
