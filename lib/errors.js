/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Error classes and helpers
 */

var assert = require('assert-plus');
var restify = require('restify');
var util = require('util');



// --- Error classes



/**
 * Base class for invalid / missing parameters
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



module.exports = {
    INVALID_MSG: 'Invalid parameters',
    invalidParam: invalidParam,
    InvalidParamsError: InvalidParamsError,
    missingParam: missingParam,
    PermissionDeniedError: PermissionDeniedError
};
