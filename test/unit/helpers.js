/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Test helpers for FWAPI unit tests
 */

'use strict';

var app;
var assert = require('assert-plus');
var fwapiClient = require('sdc-clients/lib/fwapi');
var mockery = require('mockery');
var mocks = require('./mocks');
var mod_common = require('../lib/common');
var mod_log = require('../lib/log');
var mod_moray = require('../../lib/moray');
var mod_update = require('../../lib/update');
var mod_uuid = require('node-uuid');
var moray_sandbox = require('moray-sandbox');
var os = require('os');


// --- Globals



var CUR_IP = 1;
var FWRULE_VERSION = process.env.FWRULE_VERSION || 3;
var MOCKS_ENABLED = false;
var MULTI_SUITE_RUN = false;
var OWNER_UUID = mod_uuid.v4();
var PGHANDLE = null;
var SERVER = null;
var SERVER_UUID = mod_uuid.v4();


function getPG(log, callback) {
    if (PGHANDLE !== null) {
        callback(null, PGHANDLE);
    } else {
        moray_sandbox.createPG(log, function (err, pg) {
            if (pg) {
                PGHANDLE = pg;
            }
            callback(err, pg);
        });
    }
}


// --- Exports


/**
 * Create a new Moray instance, wait until the client is connected, and then
 * initialize the UFDS bucket. Once finished, return the Moray client to the
 * callback.
 */
function setupMoray(log, callback) {
    getPG(log, function (pgErr, pg) {
        if (pgErr) {
            callback(pgErr);
            return;
        }

        pg.spawnMoray(function (mErr, moray) {
            if (mErr) {
                callback(mErr);
                return;
            }

            mod_moray.waitForConnect(moray, function (wErr) {
                if (wErr) {
                    callback(wErr);
                    return;
                }

                /* Create a basic ufds bucket to test migrations from UFDS */
                moray.createBucket('ufds_o_smartdc', {
                    index: {
                        'uuid': { type: 'string' },
                        'objectclass': { type: '[string]' }
                    }
                }, function (cErr) {
                    callback(cErr, moray);
                });
            });
        });
    });
}


/**
 * Creates a test FWAPI server, and returns a client for accessing it
 */
function createClientAndServer(opts, callback) {
    assert.object(opts, 'opts');
    assert.func(callback, 'callback');

    if (SERVER !== null) {
        throw new Error('Cannot run multiple FWAPI servers at once!');
    }

    var log = opts.log || mod_log.selectUnitLogger();

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
            fwrule_version: opts.fwrule_version || FWRULE_VERSION,
            pollInterval: 3000,
            port: 0,
            ufds: { }
        },
        log: log
    });

    // XXX: replace with a real mock
    server.vmapi = {};

    function startServerWithMoray(err, moray) {
        if (err) {
            moray.close();
            callback(err);
            return;
        }

        server.moray = moray;
        server.listen(function (lErr) {
            SERVER = server;

            callback(lErr, new fwapiClient({
                agent: false,
                url: server.info().url
            }), moray);
        });
    }

    if (opts.moray) {
        startServerWithMoray(null, opts.moray);
    } else {
        setupMoray(log, startServerWithMoray);
    }
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
function getMorayUpdates(moray, callback) {
    var updates = [];
    var req = moray.findObjects(mod_update.BUCKET.name, '(uuid=*)',
        { sort: { attribute: '_id', order: 'ASC' } });
    req.on('record', function (rec) {
        updates.push(rec.value);
    });
    req.on('error', callback);
    req.on('end', function () {
        var delBatch = updates.map(function (update) {
            return {
                bucket: mod_update.BUCKET.name,
                key: update.uuid,
                operation: 'delete'
            };
        });
        updates.forEach(function (update) {
            delete update.uuid;
        });
        moray.batch(delBatch, function (err) {
            callback(err, updates);
        });
    });
}


/**
 * Returns a moray update object
 */
function morayUpdate(name, val) {
    return {
        _v: mod_update.BUCKET.version,
        host: os.hostname(),
        name: name,
        value: val
    };
}


function setupMocks() {
    if (!MOCKS_ENABLED) {
        mockery.enable({ warnOnUnregistered: false });
        for (var m in mocks) {
            if (m.indexOf('_') !== 0) {
                mockery.registerMock(m, mocks[m]);
            }
        }

        MOCKS_ENABLED = true;
    }
}


/**
 * Stops the Postgres server so that it can be cleaned up
 */
function stopPG() {
    if (PGHANDLE !== null) {
        PGHANDLE.stop();
        PGHANDLE = null;
    }
}


/**
 * Stops the test FWAPI server
 */
function stopServer(t) {
    function done(err) {
        if (!MULTI_SUITE_RUN) {
            stopPG();
        }
        t.ifError(err, 'Server stop');
        t.end();
    }

    if (SERVER === null) {
        done();
        return;
    }

    SERVER.close(done);
    SERVER = null;
}


/**
 * Sort by rule UUID
 */
function uuidSort(a, b) {
    return (a.uuid > b.uuid) ? 1 : -1;
}



module.exports = {
    set MULTI_SUITE_RUN(val) {
        MULTI_SUITE_RUN = val;
    },
    get MULTI_SUITE_RUN() {
        return MULTI_SUITE_RUN;
    },
    createClientAndServer: createClientAndServer,
    ifErr: mod_common.ifErr,
    generateVM: generateVM,
    getMorayUpdates: getMorayUpdates,
    morayUpdate: morayUpdate,
    setupMoray: setupMoray,
    stopPG: stopPG,
    stopServer: stopServer,
    uuidSort: uuidSort
};
