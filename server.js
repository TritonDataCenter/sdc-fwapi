/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * Main entry-point for the firewall API.
 */

'use strict';

var fwapi = require('./lib/app');
var assert = require('assert-plus');
var bunyan = require('bunyan');
var fs = require('fs');
var restify = require('restify');
var tritonTracer = require('triton-tracer');



// --- Globals



var CONFIG_FILE = __dirname + '/config.json';



// --- Functions



/**
 * Loads the config, throwing an error if the config is incomplete / invalid
 */
function loadConfig(configFile) {
    assert.string(configFile, 'configFile');
    var config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    if (!config.hasOwnProperty('port')) {
        config.port = 80;
    }
    if (config.hasOwnProperty('fwrule_version')) {
        assert.number(config.fwrule_version, 'config.fwrule_version');
    } else {
        config.fwrule_version = 1;
    }

    assert.optionalNumber(config.maxHttpSockets, 'config.maxHttpSockets');

    return config;
}


/**
 * Main entry point
 */
function main() {
    var server;
    var log = bunyan.createLogger({
        name: 'fwapi',
        level: 'info',
        serializers: restify.bunyan.serializers
    });

    log.info('Loading config file: %s', CONFIG_FILE);
    var config = loadConfig(CONFIG_FILE);
    if (config.logLevel) {
        log.level(config.logLevel);
    }

    tritonTracer.init({log: log});

    try {
        server = fwapi.create({
            config: config,
            log: log
        });
    } catch (err) {
        log.error(err, 'Error creating server');
        process.exit(1);
    }

    server.listen(function (lErr) {
        if (lErr) {
            throw lErr;
        }
        var addr = server.info();
        log.info('%s listening on <http://%s:%s>',
            addr.name, addr.address, addr.port);
    });

    // Try to ensure we clean up properly on exit.
    process.on('SIGINT', function _cleanup() {
        log.info('SIGINT: cleaning up');
        return server.close(function () {
            process.exit(1);
        });
    });
}

main();
