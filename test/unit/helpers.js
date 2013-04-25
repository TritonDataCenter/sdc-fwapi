/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Test helpers for FWAPI unit tests
 */

var assert = require('assert-plus');
var async = require('async');
var app = require('../../lib/app');
var clone = require('clone');
var fwapiClient = require('sdc-clients/lib/fwapi');
var fw_shared;
var mockery = require('mockery');
var mocks = require('./mocks');
var mod_uuid = require('node-uuid');
var restify = require('restify');
var util = require('util');
var verror = require('verror');
var wf_add;
var wf_del;
var wf_update;


// --- Globals



var BUCKETS = {};
var CUR_IP = 1;
// Set to log messages to stderr
var LOG = process.env.LOG || false;
var OWNER_UUID = mod_uuid.v4();
var SERVER;
var SERVER_UUID = mod_uuid.v4();



// --- Internal helpers



// --- Fake WFAPI object


function FakeWFAPI(params) {
    this.log = params.log;
    this.results = {};
}


FakeWFAPI.prototype.createJob = function _createJob(name, params, callback) {
    var self = this;
    var wf;
    var uuid = mod_uuid.v4();

    switch (name) {
    case 'fw-add':
        wf = wf_add;
        break;
    case 'fw-del':
        wf = wf_del;
        break;
    case 'fw-update':
        wf = wf_update;
        break;
    default:
        return callback(
            new verror.VError('FakeWFAPI: unknown workflow "%s"', name));
        /* jsl:ignore */
        break;
        /* jsl:end */
    }

    var chainDone = 0;
    var lastTask = '';
    var job = {
        log: self.log,
        params : clone(params)
    };

    self.log.debug('workflow %s: begin', name);
    async.forEachSeries(wf.chain, function (task, cb) {
        lastTask = task.name;

        self.log.debug('workflow %s/%s: start', name, task.name);
        return task.body(job, function (err, res) {
            chainDone++;
            cb(err, res);
        });
    }, function (err) {
        var res = {
            done: (chainDone == wf.chain.length),
            last: lastTask,
            name: name
        };

        if (err) {
            res.err = err;
        }

        self.results[uuid] = res;
        self.log.debug('workflow %s: end', name);

        return callback(null, { uuid: uuid });
    });
};



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
            trace: function () { return false; },
            warn: function () { return false; }
        };
    }

    setupMocks();
    var server = app.create({
        config: {
            datacenter: 'coal',
            port: 0,
            ufds: { },
            wfapi: { }
        },
        log: log
    });
    mocks._LOGGER = log;

    server.ufds = new mocks['sdc-clients'].UFDS;
    server.wfapi = new FakeWFAPI({ log: log });
    // XXX: replace with a real mock
    server.vmapi = {};

    [wf_add, wf_update, wf_del].forEach(function (wf) {
        wf._set({
            cnapiUrl: 'http://unused',
            ufdsDn: 'ou=fwrulesMock',
            ufdsPassword: 'password',
            ufdsUrl: 'http://unused'
        });
    });
    fw_shared._set({
        fwapiUrl: 'http://unused',
        vmapiUrl: 'http://unused'
    });

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

    if (!mocks._SERVERS.hasOwnProperty(vm.server_uuid)) {
        mocks._SERVERS[vm.server_uuid] = {};
    }

    if (!mocks._SERVERS[vm.server_uuid].hasOwnProperty('sysinfo')) {
        mocks._SERVERS[vm.server_uuid].sysinfo = {
            'SDC Version': '7.0'
        };
    }

    return vm;
}


function setupMocks() {
    mockery.enable({ warnOnUnregistered: false });
    for (var m in mocks) {
        if (m.indexOf('_') !== 0) {
            mockery.registerMock(m, mocks[m]);
        }
    }

    wf_add = require('../../lib/workflows/fw-add');
    wf_del = require('../../lib/workflows/fw-del');
    wf_update = require('../../lib/workflows/fw-update');
    fw_shared = require('wf-shared').fwapi;
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


/**
 * Returns the workflow results
 */
function wfResults() {
    assert.object(SERVER);

    return SERVER.wfapi.results;
}



module.exports = {
    createClientAndServer: createClientAndServer,
    generateVM: generateVM,
    stopServer: stopServer,
    uuidSort: uuidSort,
    wfResults: wfResults
};
