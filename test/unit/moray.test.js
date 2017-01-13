/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Moray bucket setup tests
 */

'use strict';

var constants = require('../../lib/util/constants');
var h = require('./helpers');
var migr_data = require('./data/migration');
var mod_log = require('../lib/log');
var mod_moray = require('../../lib/moray');
var mod_rule = require('../../lib/rule');
var test = require('tape');

// --- Globals

var MORAY = null;
var MUST_STOP = false;

var ERROR_COUNT = constants.MAX_RETRIES + 1;
var LOG = mod_log.selectUnitLogger();

var originalDelay = constants.RETRY_DELAY;

var timeError = new Error('Query timed out');
timeError.name = 'QueryTimeoutError';

var etagError = new Error('Already exists');
etagError.name = 'EtagConflictError';


// --- Helpers

function startupFailure(t, mockFailures) {
    mod_moray.waitForConnect(MORAY.clone(), function (wErr, moray) {
        if (h.ifErr(t, wErr, 'waitForConnect() error')) {
            t.end();
            return;
        }

        moray.setMockErrors(mockFailures);

        h.createClientAndServer({
            log: LOG,
            moray: moray
        }, function (cErr) {
            t.ok(cErr, 'FWAPI startup error');

            h.stopServer(t);
        });
    });
}


function startupSuccess(t, mockFailures) {
    mod_moray.waitForConnect(MORAY.clone(), function (wErr, moray) {
        if (h.ifErr(t, wErr, 'waitForConnect() error')) {
            t.end();
            return;
        }

        if (mockFailures) {
            moray.setMockErrors(mockFailures);
        } else {
            moray.setMockErrors({});
        }

        h.createClientAndServer({
            log: LOG,
            moray: moray
        }, function (cErr, res) {
            t.ok(res, 'client');
            if (h.ifErr(t, cErr, 'FWAPI startup error')) {
                t.end();
                return;
            }

            h.stopServer(t);
        });
    });
}


function loadData(t2) {
    var key = migr_data.RULE_1_UUID;
    var obj = migr_data.rules[key].v1;
    var opts = { etag: null };
    MORAY.createBucket(mod_rule.BUCKET.name, migr_data.RULES_SCHEMA_V1,
        function (cErr) {
        if (h.ifErr(t2, cErr, 'createBucket() error')) {
            t2.end();
            return;
        }

        MORAY.putObject(mod_rule.BUCKET.name, key, obj, opts,
            function (pErr) {
            t2.ifErr(pErr, 'putObject() error');
            t2.end();
        });
    });
}


function createClient(t) {
    h.setupMoray(LOG, function (err, moray) {
        t.ifErr(err, 'Moray setup error');
        t.ok(moray, 'moray');

        MORAY = moray;
        t.end();
    });
}


function closeClient(t) {
    MORAY.close();
    MORAY = null;
    t.end();
}


function fillArray(item, count) {
    var arr = [];
    for (var i = 0; i < count; i++) {
        arr.push(item);
    }
    return arr;
}


// --- Setup

if (!h.MULTI_SUITE_RUN) {
    h.MULTI_SUITE_RUN = true;
    MUST_STOP = true;
}


test('Setup', function (t) {
    // Lower retry delay so that tests don't take forever.
    constants.RETRY_DELAY = 500;
    t.end();
});


// --- Tests

test('putBucket() failures and rollbacks', function (t) {
    t.plan(9);

    t.test('Start Moray server', createClient);

    t.test('Fail to start FWAPI (getBucket() failures)', function (t2) {
        startupFailure(t2, {
            getBucket: fillArray(timeError, ERROR_COUNT)
        });
    });

    t.test('Fail to start FWAPI (createBucket() failures)', function (t2) {
        startupFailure(t2, {
            createBucket: fillArray(timeError, ERROR_COUNT)
        });
    });

    t.test('Start FWAPI (creates bucket)', startupSuccess);

    t.test('Start FWAPI (no bucket changes)', startupSuccess);

    t.test('Fail to start FWAPI (updateBucket() failures)', function (t2) {
        // Roll version forward and restart
        mod_rule.BUCKET.version += 1;
        startupFailure(t2, {
            updateBucket: fillArray(timeError, ERROR_COUNT)
        });
    });

    t.test('Start FWAPI (updates bucket)', startupSuccess);

    t.test('Start FWAPI (rollback)', function (t2) {
        // Roll back version and restart
        mod_rule.BUCKET.version -= 1;
        startupSuccess(t2);
    });

    t.test('Close Moray client', closeClient);
});


test('reindex() failures', function (t) {
    t.plan(4);

    t.test('Start Moray server', createClient);

    t.test('Fail to start FWAPI (reindexObjects() failures)', function (t2) {
        startupFailure(t2, {
            reindexObjects: fillArray(timeError, ERROR_COUNT)
        });
    });

    t.test('Start FWAPI (success after several failures)', function (t2) {
        startupSuccess(t2, {
            reindexObjects: fillArray(timeError, constants.MAX_RETRIES)
        });
    });

    t.test('Close Moray client', closeClient);
});


test('updateRecords() failures', function (t) {
    t.plan(6);

    t.test('Start Moray server', createClient);

    t.test('Load rule to migrate', loadData);

    t.test('Fail to start FWAPI (findObjects() failures)', function (t2) {
        startupFailure(t2, {
            findObjects: fillArray(timeError, ERROR_COUNT)
        });
    });

    t.test('Fail to start FWAPI (batch() failures)', function (t2) {
        startupFailure(t2, {
            batch: fillArray(timeError, ERROR_COUNT)
        });
    });

    t.test('Start FWAPI (success after several failures)', function (t2) {
        startupSuccess(t2, {
            batch: fillArray(timeError, constants.MAX_RETRIES)
        });
    });

    t.test('Close Moray client', closeClient);
});


test('updateRecords() success after many EtagConflictErrors', function (t) {
    t.plan(4);

    t.test('Start Moray server', createClient);

    t.test('Load rule to migrate', loadData);

    t.test('Start FWAPI (w/ MAX_RETRIES*2 EtagConflictErrors)', function (t2) {
        startupSuccess(t2, {
            batch: fillArray(etagError, constants.MAX_RETRIES * 2)
        });
    });

    t.test('Close Moray client', closeClient);
});


// --- Teardown


test('Cleanup', function (t) {
    // Lower retry delay so that tests don't take forever.
    constants.RETRY_DELAY = originalDelay;
    t.end();
});


if (MUST_STOP) {
    test('Stop PG', function (t) {
        h.stopPG();
        t.end();
    });
}
