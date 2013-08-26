/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for /resolve endpoint
 */

var async = require('async');
var helpers = require('./helpers');
var mod_uuid = require('node-uuid');
var util = require('util');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var FWAPI;
var OWNERS = [0, 1, 2, 3, 4, 5].map(function () { return mod_uuid.v4(); });
var RULES = [];
var VMS = [0, 1, 2].map(function () { return mod_uuid.v4(); });



// --- Setup



exports.setup = function (t) {
    FWAPI = helpers.createClient();
    var rules = [
        // OWNERS[0] rules
        'FROM tag other TO tag role ALLOW tcp PORT 5432',
        util.format('FROM vm %s TO tag role = web ALLOW tcp PORT 80',
            VMS[0]),
        'FROM (tag foo = bar OR tag foo = baz) TO tag role = web ALLOW tcp '
            + 'PORT 5433',
        util.format('FROM vm %s TO tag role = other ALLOW tcp PORT 81',
            VMS[1]),
        'FROM tag now = then TO tag role = other ALLOW tcp PORT 82'
    ].map(function (r) {
        return { enabled: true, owner_uuid: OWNERS[0], rule: r };
    }).concat([
        {
            owner_uuid: OWNERS[1],
            rule: util.format('FROM vm %s TO all vms BLOCK udp PORT 54',
                VMS[2]),
            enabled: true
        },
        {
            owner_uuid: OWNERS[2],
            rule: 'FROM tag one TO all vms BLOCK udp PORT 55',
            enabled: true
        },
        {
            owner_uuid: OWNERS[3],
            rule: 'FROM tag one TO all vms ALLOW udp PORT 56',
            enabled: true
        },
        {
            owner_uuid: OWNERS[4],
            rule: 'FROM all vms TO tag one BLOCK udp PORT 57',
            enabled: true
        },
        {
            owner_uuid: OWNERS[5],
            rule: 'FROM all vms TO tag one ALLOW udp PORT 58',
            enabled: true
        }
    ]);

    async.forEachSeries(rules, function (rule, cb) {
        FWAPI.createRule(rule, function (err, obj, req, res) {
            if (helpers.ifErr(t, err, 'rule create: ' + rule.rule)) {
                return cb(err);
            }

            t.equal(res.statusCode, 202, 'status code');
            t.ok(obj.uuid, 'rule has uuid');
            t.ok(obj.version, 'rule has version');
            rule.uuid = obj.uuid;
            rule.version = obj.version;

            t.deepEqual(obj, rule, 'response');
            RULES.push(rule);

            FWAPI.getRule(rule.uuid, function (err2, res2) {
                if (helpers.ifErr(t, err2, 'get rule: ' + rule.uuid)) {
                    return cb(err2);
                }

                t.deepEqual(res2, rule, 'getRule');
                return cb();
            });
        });

    }, function (err) {
        return t.done();
    });
};


exports['resolve'] = function (t) {
    var exp = [
    // Querying for all rules with tag role: should return all rules with
    // that tag, even if they're more specific (eg: tag = "some value")
    [   'all role rules',
        {
            owner_uuid: OWNERS[0],
            tags: { role: true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [0, 1, 2, 3, 4].map(function (n) {
                return RULES[n];
            }).sort(helpers.uuidSort),
            tags: { other: true, foo: ['bar', 'baz'], now: ['then'] },
            vms: [ VMS[0], VMS[1] ].sort()
        } ],

    [   'role = web',
        {
            owner_uuid: OWNERS[0],
            tags: { role: 'web' }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [ RULES[0], RULES[1], RULES[2] ].sort(helpers.uuidSort),
            tags: { other: true, foo: ['bar', 'baz'] },
            vms: [ VMS[0] ]
        } ],

    [   'role = other',
        {
            owner_uuid: OWNERS[0],
            tags: { role: 'other' }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [ RULES[0], RULES[3], RULES[4] ].sort(helpers.uuidSort),
            tags: { other: true, now: ['then'] },
            vms: [ VMS[1] ]
        } ],

    [   util.format('vm to all OWNERS[1] (%s) VMs', OWNERS[1]),
        {
            owner_uuid: OWNERS[1],
            vms: [ VMS[2] ]
        },
        {
            // VM 1 matches on both sides of RULE 5: it's explicitly on the
            // FROM side, and implicitly through 'all vms' on the TO side.
            // However, BLOCK + a match on the TO side is a no-op, so only
            // allVMs is set
            allVMs: true,
            owner_uuid: OWNERS[1],
            rules: [ RULES[5] ],
            tags: { },
            vms: [ ]
        } ],

    [   util.format('OWNERS[2] (%s): tag does_not_exist', OWNERS[2]),
        {
            owner_uuid: OWNERS[2],
            tags: { does_not_exist: true }
        },
        {
            // This should match all vms, but because it's an incoming block
            // to all vms (which is a no-op, since the default ruleset is
            // block all inbound), tag one from the other side should not
            // show up here
            allVMs: false,
            owner_uuid: OWNERS[2],
            rules: [ RULES[6] ],
            tags: { },
            vms: [ ]
        } ],

    [   util.format('OWNERS[3] (%s): tag one', OWNERS[3]),
        {
            owner_uuid: OWNERS[3],
            tags: { one: true }
        },
        {
            // This matches both tag one and all vms, but the outgoing allow
            // from tag one is a no-op, so only return tag one
            allVMs: false,
            owner_uuid: OWNERS[3],
            rules: [ RULES[7] ],
            tags: { one: true },
            vms: [ ]
        } ],

    [   util.format('OWNERS[4] (%s): tag does_not_exist', OWNERS[4]),
        {
            owner_uuid: OWNERS[4],
            tags: { does_not_exist: true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[4],
            rules: [ RULES[8] ],
            tags: { one: true },
            vms: [ ]
        } ],

    [   util.format('OWNERS[4] (%s): tag one', OWNERS[4]),
        {
            owner_uuid: OWNERS[4],
            tags: { one: true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[4],
            rules: [ RULES[8] ],
            tags: { one: true },
            vms: [ ]
        } ],

    [   util.format('OWNERS[5] (%s): tag does_not_exist', OWNERS[5]),
        {
            owner_uuid: OWNERS[5],
            tags: { does_not_exist: true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[5],
            rules: [ RULES[9] ],
            tags: { },
            vms: [ ]
        } ],

    [   util.format('OWNERS[5] (%s): tag one', OWNERS[5]),
        {
            owner_uuid: OWNERS[5],
            tags: { one: true }
        },
        {
            allVMs: true,
            owner_uuid: OWNERS[5],
            rules: [ RULES[9] ],
            tags: { },
            vms: [ ]
        } ]

        // XXX: need a test for passing in vms

    ];

    async.forEachSeries(exp, function (data, cb) {
        var desc = ': ' + data[0];
        FWAPI.post('/resolve', data[1], function (err, res) {
            if (helpers.ifErr(t, err, 'resolve' + desc)) {
                return cb(err);
            }

            res.rules.sort(helpers.uuidSort);
            t.deepEqual(res.rules.map(function (r) { return r.rule; }).sort(),
                data[2].rules.map(function (r) { return r.rule; }).sort(),
                'rule text' + desc);

            t.deepEqual(res, data[2], 'resolved data' + desc);
            return cb();
        });

    }, function (err) {
        return t.done();
    });
};



// --- Teardown



exports.teardown = function (t) {
    async.forEachSeries(RULES, function (rule, cb) {
        FWAPI.deleteRule(rule.uuid, function (err) {
            helpers.ifErr(t, err, 'deleting: ' + rule.uuid);
            return cb(err);
        });

    }, function (err) {
        return t.done();
    });
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports.setup,
        oneTest: runOne,
        teardown: exports.teardown
    };
}
