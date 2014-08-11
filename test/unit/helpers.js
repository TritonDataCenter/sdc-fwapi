/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Test helpers for FWAPI unit tests
 */

var assert = require('assert-plus');
var async = require('async');
var app;
var clone = require('clone');
var fwapiClient = require('sdc-clients/lib/fwapi');
var mockery = require('mockery');
var mocks = require('./mocks');
var mod_uuid = require('node-uuid');
var os = require('os');
var restify = require('restify');
var util = require('util');
var verror = require('verror');


// --- Globals



var BUCKETS = {};
var CUR_IP = 1;
// Set to log messages to stderr
var LOG = process.env.LOG || false;
var OWNER_UUID = mod_uuid.v4();
var SERVER;
var SERVER_UUID = mod_uuid.v4();



// --- Exports



/**
 * Creates a test NAPI server, and returns a client for accessing it
 */
function createClientAndServer(callback) {
    var log;
    if (LOG) {
        log = require('bunyan').createLogger({
            level: (process.env.LOG_LEVEL || 'warn'),
            name: process.argv[1],
            stream: process.stderr,
            serializers: restify.bunyan.serializers,
            src: true
        });

    } else {
        log = {
            child: function () { return log; },
            debug: function () { return false; },
            error: function () { return false; },
            info: function () { return false; },
            level: function () { return (process.env.LOG_LEVEL || 'warn'); },
            trace: function () { return false; },
            warn: function () { return false; }
        };
    }

    setupMocks();
    app = require('../../lib/app');
    var server = app.create({
        config: {
            datacenter: 'coal',
            fast: {
                port: 2020
            },
            moray: {
                host: 'unused',
                port: 2020
            },
            pollInterval: 3000,
            port: 0,
            ufds: { }
        },
        log: log
    });
    mocks._LOGGER = log;

    // XXX: remove this
    server.ufds = new mocks['sdc-clients'].UFDS;
    // XXX: replace with a real mock
    server.vmapi = {};

    server.listen(function () {
        SERVER = server;

        return callback(null, new fwapiClient({
            agent: false,
            url: server.info().url
        }));
    });
}


function generateVM(override) {
    var vm = {
        firewall_enabled: true,
        owner_uuid: OWNER_UUID,
        server_uuid: SERVER_UUID,
        tags: {},
        uuid: mod_uuid.v4()
    };

    if (!override || !override.hasOwnProperty('nics')) {
        vm.nics = [ {
            ip: '10.0.2.' + CUR_IP++
        } ];
    }

    if (override) {
        for (var o in override) {
            vm[o] = override[o];
        }
    }

    return vm;
}


/**
 * Gets update records from the fwapi_updates moray bucket (and deletes them
 * after, since we don't care about actually applying them)
 */
function getMorayUpdates() {
    var buckets = mocks._BUCKETS;
    var updates = [];

    for (var k in buckets.fwapi_updates) {
        updates.push(buckets.fwapi_updates[k]);
        delete buckets.fwapi_updates[k];
    }

    return updates;
}


/**
 * Returns a moray update object
 */
function morayUpdate(name, val) {
    return {
        _v: 1,
        host: os.hostname(),
        name: name,
        value: val
    };
}


function setupMocks() {
    mockery.enable({ warnOnUnregistered: false });
    for (var m in mocks) {
        if (m.indexOf('_') !== 0) {
            mockery.registerMock(m, mocks[m]);
        }
    }
}


/**
 * Stops the test NAPI server
 */
function stopServer(callback) {
    if (!SERVER) {
        return callback();
    }

    return SERVER.close(callback);
}


/**
 * Sort by rule UUID
 */
function uuidSort(a, b) {
    return (a.uuid > b.uuid) ? 1 : -1;
}



module.exports = {
    createClientAndServer: createClientAndServer,
    generateVM: generateVM,
    getMorayUpdates: getMorayUpdates,
    morayUpdate: morayUpdate,
    stopServer: stopServer,
    uuidSort: uuidSort
};
