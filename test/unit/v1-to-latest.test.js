/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Rule Moray format migration tests: v1 to latest
 */

'use strict';

var constants = require('../../lib/util/constants');
var h = require('./helpers');
var migr_data = require('./data/migration');
var mod_log = require('../lib/log');
var mod_rule = require('../../lib/rule');
var mod_update = require('../../lib/update');
var mod_vasync = require('vasync');
var test = require('tape');

// --- Globals

var MORAY;
var FWAPI;
var RULE_COUNT = 12 + migr_data.GENERIC_COUNT;

// A limit higher than the rules we have.
var ADJ_LIMIT = RULE_COUNT + 100;

var rules = migr_data.rules;
var updates = migr_data.updates;

// --- Helpers


function zeroV1rules(t) {
    var res = MORAY.findObjects(mod_rule.BUCKET.name, '(_v=1)');
    var count = 0;

    res.on('error', function (err) {
        h.ifErr(err, 'Listing rules from bucket failed');
        t.end();
    });

    res.on('record', function (rec) {
        t.deepEqual(rec, undefined, 'v1 firewall rule in rules bucket');
        count += 1;
    });

    res.on('end', function () {
        t.equal(count, 0, 'No more v1 rules in rules bucket');
        t.end();
    });
}


// --- Setup


test('Initial setup', function (t) {
    var log;

    t.plan(6);

    t.test('Start Moray server', function (t2) {
        log = mod_log.selectUnitLogger();
        h.setupMoray(log, function (err, moray) {
            t2.ifErr(err, 'Moray setup error');
            t2.ok(moray, 'moray');

            MORAY = moray;
            t2.end();
        });
    });

    t.test('Create old version of rules bucket', function (t2) {
        MORAY.createBucket(mod_rule.BUCKET.name,
            migr_data.RULES_SCHEMA_V1, function (cErr) {
            h.ifErr(t2, cErr, 'createBucket() error');
            t2.end();
        });
    });

    t.test('Load rules into rules bucket', function (t2) {
        var batch = [];
        Object.keys(rules).forEach(function (key) {
            var value = rules[key];
            if (!value.hasOwnProperty('v1')) {
                return;
            }

            batch.push({
                bucket: mod_rule.BUCKET.name,
                operation: 'put',
                key: key,
                value: value.v1,
                options: { etag: null }
            });
        });
        MORAY.batch(batch, function (err) {
            t2.ifErr(err, 'Load error');
            t2.end();
        });
    });

    t.test('Create old version of "fwapi_updates"', function (t2) {
        MORAY.createBucket(mod_update.BUCKET.name,
            migr_data.ORIG_UPDATE_SCHEMA, function (cErr) {
            h.ifErr(t2, cErr, 'createBucket() error');
            t2.end();
        });
    });

    t.test('Load pending updates into "fwapi_updates"', function (t2) {
        mod_vasync.forEachParallel({
            inputs: Object.keys(updates),
            func: function (key, cb) {
                MORAY.putObject(mod_update.BUCKET.name,
                    key, updates[key].orig, { etag: null }, cb);
            }
        }, function (err) {
            t2.ifErr(err, 'Load error');
            t2.end();
        });
    });

    t.test('Start FWAPI', function (t2) {
        h.createClientAndServer({
            log: log,
            moray: MORAY
        }, function (err, res) {
            t2.ifError(err, 'FWAPI startup error');
            t2.ok(res, 'client');

            FWAPI = res;
            t2.end();
        });
    });
});


// --- Tests


test('Rules bucket no longer contains v1 firewall rules', zeroV1rules);


test('Check that rules have migrated successfully', function (t) {
    var originalLimit = constants.DEFAULT_LIMIT;
    constants.DEFAULT_LIMIT = ADJ_LIMIT;

    FWAPI.listRules({}, {}, function (lErr, fwrules) {
        constants.DEFAULT_LIMIT = originalLimit;

        if (h.ifErr(t, lErr, 'Error listing rules')) {
            t.end();
            return;
        }

        t.ok(fwrules, 'Rules returned');
        t.equal(fwrules.length, RULE_COUNT, 'Correct number of rules');

        fwrules.forEach(function (fwrule) {
            t.ok(rules[fwrule.uuid],
                fwrule.uuid + ' is one of the original rules');
            t.deepEqual(fwrule, rules[fwrule.uuid].fwapi,
                fwrule.uuid + ' matches expected return value');
        });
        t.end();
    });
});


test('"fwapi_rules" bucket still contains all rules', function (t) {
    var res = MORAY.findObjects(mod_rule.BUCKET.name, '(uuid=*)',
        { limit: ADJ_LIMIT });
    var count = 0;

    res.on('error', function (err) {
        h.ifErr(err, 'listing rules from bucket failed');
        t.end();
    });

    res.on('record', function (rec) {
        count += 1;

        t.ok(rec, 'Found record');
        t.ok(rules[rec.value.uuid],
            rec.value.uuid + ' is one of the original rules');
        t.deepEqual((new mod_rule.Rule(rec, {})).serialize(),
            rules[rec.value.uuid].fwapi, 'Correct contents in Moray');
    });

    res.on('end', function () {
        t.equal(count, RULE_COUNT, 'All rules are in Moray bucket');
        t.end();
    });
});


test('Search for rule that previously had escaped characters', function (t) {
    t.plan(2);

    t.test('Searching for "⛄"', function (t2) {
        FWAPI.listRules({ tag: '⛄' }, function (err, fwrules) {
            if (h.ifErr(t2, err, 'listRules() error')) {
                t2.end();
                return;
            }

            t2.deepEqual(fwrules, [ rules[migr_data.RULE_6_UUID].fwapi ],
                'Correct rule returned');
            t2.end();
        });
    });

    t.test('Searching for "☃"', function (t2) {
        FWAPI.listRules({ tag: '☃' }, function (err, fwrules) {
            if (h.ifErr(t2, err, 'listRules() error')) {
                t2.end();
                return;
            }

            t2.deepEqual(fwrules, [ rules[migr_data.RULE_6_UUID].fwapi ],
                'Correct rule returned');
            t2.end();
        });
    });
});

test('No new v1 rules created', function (t) {
    var rule = {
        rule: 'FROM tag "foo" = "hello-world" TO tag "bar" ALLOW tcp PORT 22',
        description: 'Rule added after migration',
        enabled: true,
        log: false,
        owner_uuid: migr_data.OWNER_4
    };

    t.plan(3);

    t.test('Add rule to FWAPI', function (t2) {
        FWAPI.createRule(rule, function (err, obj, req, res) {
            if (h.ifErr(t2, err, 'createRule() error')) {
                t2.end();
                return;
            }

            t2.deepEqual(res.statusCode, 202, 'Status code');

            t2.ok(obj.uuid, 'Rule has UUID');
            t2.ok(obj.version, 'Rule has version');

            rule.uuid = obj.uuid;
            rule.version = obj.version;

            t2.deepEqual(obj, rule, 'Returned submitted rule');
            t2.end();
        });
    });

    t.test('Get rule from FWAPI', function (t2) {
        FWAPI.getRule(rule.uuid, function (err, obj, req, res) {
            if (h.ifErr(t2, err, 'getRule() error')) {
                t2.end();
                return;
            }

            t2.deepEqual(res.statusCode, 200, 'Status code');
            t2.deepEqual(obj, rule, 'Returned submitted rule');
            t2.end();
        });
    });

    t.test('No v1 rules created', zeroV1rules);
});


// --- Teardown



test('Stop server', h.stopServer);
