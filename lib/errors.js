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



module.exports = {
    ExistsError: ExistsError,
    createExistsErr: createExistsErr,
    duplicateParam: duplicateParam,
    INVALID_MSG: 'Invalid parameters',
    invalidParam: invalidParam,
    InvalidParamsError: InvalidParamsError,
    missingParam: missingParam,
    PermissionDeniedError: PermissionDeniedError
};
