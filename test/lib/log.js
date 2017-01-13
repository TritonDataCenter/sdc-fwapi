/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * bunyan logger for tests
 */

'use strict';

var bunyan = require('bunyan');
var restify = require('restify');


var LOG = process.env.LOG || false; // Set to log messages to stderr
var LOGGER = null;


function mkFileLogger() {
    return bunyan.createLogger({
        name: 'fwtest',
        serializers: bunyan.stdSerializers,
        streams: [
            {
                level: process.env.LOG_LEVEL || 'info',
                stream: process.stderr
            },
            {
                level: 'debug' || process.env.LOG_FILE_LEVEL,
                path: '/var/log/fwtest.log'
            }
        ]
    });
}


function mkMockLogger() {
    var log = {
        child: function () { return log; },
        debug: function () { return false; },
        error: function () { return false; },
        info: function () { return false; },
        level: function () { return (process.env.LOG_LEVEL || 'warn'); },
        trace: function () { return false; },
        warn: function () { return false; }
    };

    return log;
}


function mkStdoutLogger() {
    return bunyan.createLogger({
        level: (process.env.LOG_LEVEL || 'warn'),
        name: process.argv[1],
        stream: process.stderr,
        serializers: restify.bunyan.serializers,
        src: true
    });
}


/**
 * Select a logger suitable for use while running unit tests.
 */
function selectUnitLogger() {
    if (LOG) {
        return mkStdoutLogger();
    } else {
        return mkMockLogger();
    }
}


/**
 * Get a predetermined logger, or select a file-based one if nothing else has
 * been selected.
 */
function get() {
    if (LOGGER !== null) {
        return LOGGER;
    }

    LOGGER = mkFileLogger();

    return LOGGER;
}


/**
 * Set a logger for tests to use.
 */
function set(logger) {
    LOGGER = logger;
}


module.exports = {
    mkFileLogger: mkFileLogger,
    mkMockLogger: mkMockLogger,
    mkStdoutLogger: mkStdoutLogger,
    selectUnitLogger: selectUnitLogger,
    get: get,
    set: set
};
