/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Test helpers for dealing with the NAPI client
 */

'use strict';

var fs = require('fs');
var path = require('path');
var VError = require('verror').VError;


// --- Globals


var CFG_ERR;
var testFile = path.join(path.resolve(__dirname, '..'), 'config.json');
var config = {};
var HAVE_VARS;

try {
    config.test = JSON.parse(fs.readFileSync(testFile).toString());
} catch (err) {
    console.error('# Error loading test config %s: %s', testFile, err.message);
    config.test = {};
}


// --- Internal


function apiConfig(apiName) {
    return {
        agent: false,
        url: config.test[apiName + '_url']
    };
}


// --- Exports


config.fwapi = apiConfig('fwapi');
config.napi = apiConfig('napi');
config.vmapi = apiConfig('vmapi');
config.wfapi = apiConfig('wfapi');

config.haveTestVars = function haveTestVars(vars, callback) {
    if (CFG_ERR) {
        return callback(CFG_ERR);
    }

    if (HAVE_VARS) {
        return callback();
    }

    if (!config.test || Object.keys(config.test).length === 0) {
        CFG_ERR = new VError('No test config file at %s', testFile);
        return callback(CFG_ERR);
    }

    var missing = [];

    for (var v in vars) {
        if (!config.test.hasOwnProperty(vars[v])) {
            missing.push(vars[v]);
        }
    }

    if (missing.length !== 0) {
        CFG_ERR = new VError(' Missing required test variables: %s',
            missing.join(', '));
        return callback(CFG_ERR);
    }

    HAVE_VARS = true;
    return callback();
};



module.exports = config;
