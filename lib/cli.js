/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm: CLI shared logic
 */

var fs = require('fs');
var tty = require('tty');
var util = require('util');
var verror = require('verror');



// --- Globals



var UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;



// --- Exported functions



/**
 * Displays a list of firewall rules
 */
function displayRules(err, res, opts) {
    if (err) {
        return outputError(err, opts);
    }

    if (opts.json) {
        return console.log(json(res));
    }

    console.log('UUID                                 ENABLED RULE');
    res.forEach(function (r) {
        console.log(ruleLine(r));
    });
}


/**
 * Output an error and then exit
 */
function exitWithErr(err, opts) {
    outputError(err, opts);
    return process.exit(1);
}


/**
 * Reads the payload from one of: a file, stdin, a text argument
 */
function getPayload(opts, args, callback) {
    var file;
    if (!opts) {
        opts = {};
    }

    if (opts.file) {
        file = opts.file;
    }

    // If no file specified, try to find the rule from the commandline args
    if (!file && args.length > 0) {
        var payload = {
            rule: args.join(' ')
        };

        if (opts.enable) {
            payload.enabled = opts.enable;
        }

        ['description', 'global', 'owner_uuid'].forEach(function (p) {
            if (opts.hasOwnProperty(p)) {
                payload[p] = opts[p];
            }
        });

        return callback(null, payload);
    }

    if (!file && !tty.isatty(0)) {
        file = '-';
    }

    if (!file) {
        return callback(new verror.VError('Must supply file!'));
    }

    if (file === '-') {
        file = '/dev/stdin';
    }

    fs.readFile(file, function (err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                return callback(new verror.VError(
                    'File "%s" does not exist.', file));
            }
            return callback(new verror.VError(
                'Error reading "%s": %s', file, err.message));
        }

        // Specifying -e overrides the value in the file
        var payloadData = JSON.parse(data.toString());
        if (opts && opts.enable) {
            payloadData.enabled = true;
        }

        if (opts && opts.owner_uuid) {
            payloadData.owner_uuid = opts.owner_uuid;
        }

        return callback(null, payloadData);
    });
}


/**
 * Pretty-print a JSON object
 */
function json(obj) {
    return JSON.stringify(obj, null, 2);
}


/**
 * Outputs an error to the console, displaying all of the error messages
 * if it's a MultiError
 */
function outputError(err, opts) {
    if (opts && opts.json) {
        return console.error(json(err));
    }

    var code = '';
    if (opts && opts.verbose) {
        code = err.name + ': ';
    }

    function fieldErr(fErr, indent) {
        console.log('%s%s: %s%s', indent ? '  ' : '',
            fErr.code,
            fErr.hasOwnProperty('field') ? fErr.field + ': ' : '',
            fErr.message);
    }

    if (err.body && err.body.errors) {
        // If we only have one error, print only it out
        if (err.body.errors.length === 1) {
            fieldErr(err.body.errors[0], false);
        } else {
            console.error(code + err.message);
            err.body.errors.forEach(function (e) {
                fieldErr(e, true);
            });
        }
    } else {
        console.error(code + err.message);
    }
}


/**
 * Outputs one formatted rule line
 */
function ruleLine(r) {
    return util.format('%s %s %s', r.uuid,
        r.enabled ? 'true   ' : 'false  ', r.rule);
}


/**
 * Prints an error and exits if the UUID is invalid
 */
function validateUUID(arg) {
    if (!arg) {
        console.error('Error: missing UUID');
        process.exit(1);
    }
    if (!UUID_REGEX.test(arg)) {
        console.error('Error: invalid UUID "%s"', arg);
        process.exit(1);
    }
    return arg;
}



module.exports = {
    displayRules: displayRules,
    exitWithErr: exitWithErr,
    getPayload: getPayload,
    json: json,
    outputError: outputError,
    ruleLine: ruleLine,
    validateUUID: validateUUID
};
