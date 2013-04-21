/*
 * Copyright (c) 2012 Joyent, Inc.  All rights reserved.
 *
 * Main entry-point for the firewall API.
 */

var fwapi = require('./lib/app');
var assert = require('assert-plus');
var bunyan = require('bunyan');
var fs = require('fs');
var restify = require('restify');



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

    return config;
}


/**
 * Main entry point
 */
function main() {
    var server;
    var log = bunyan.createLogger({
        name: 'fwapi',
        level: 'debug',
        serializers: restify.bunyan.serializers
    });

    log.info('Loading config file: %s', CONFIG_FILE);
    var config = loadConfig(CONFIG_FILE);
    if (config.hasOwnProperty('logLevel')) {
        log.level(config.logLevel);
    }

    try {
        server = fwapi.create({
            config: config,
                log: log
        });
    } catch (err) {
        log.error(err, 'Error creating server');
        process.exit(1);
    }

    server.listen(function () {
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
