/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Unit tests for /resolve endpoint
 */

var async = require('async');
var helpers = require('./helpers');
var mod_rule = require('../lib/rule');
var mod_uuid = require('node-uuid');
var util = require('util');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var OWNERS = [0, 1, 2, 3, 4, 5].map(function () { return mod_uuid.v4(); });
var RULES = {};
var VMS = [0, 1, 2].map(function () { return mod_uuid.v4(); });



// --- Setup



exports.setup = function (t) {
    var r;
    var rules = [];
    RULES = {
        o0: {
            otherToRole: {
                rule: 'FROM tag other TO tag role ALLOW tcp PORT 5432'
            },
            vm0ToRoleWeb: {
                rule: util.format(
                    'FROM vm %s TO tag role = web ALLOW tcp PORT 80', VMS[0])
            },
            fooToRoleWeb: {
                rule: 'FROM (tag foo = bar OR tag foo = baz) TO tag role = web '
                    + 'ALLOW tcp PORT 5433'
            },
            vm1ToRoleOther: {
                rule: util.format(
                    'FROM vm %s TO tag role = other ALLOW tcp PORT 81', VMS[1])
            },
            nowThenToRoleOther: {
                rule:
                    'FROM tag now = then TO tag role = other ALLOW tcp PORT 82'
            },
            numOneToNumTwo: {
                rule: 'FROM tag num = one TO tag num = two ALLOW tcp PORT 55'
            }
        },

        o1: {
            vm2ToAll: {
                owner_uuid: OWNERS[1],
                rule: util.format('FROM vm %s TO all vms BLOCK udp PORT 54',
                    VMS[2]),
                enabled: true
            }
        },

        o2: {
            oneToAll: {
                owner_uuid: OWNERS[2],
                rule: 'FROM tag one TO all vms BLOCK udp PORT 55',
                enabled: true
            }
        },

        o3: {
            oneToAll: {
                owner_uuid: OWNERS[3],
                rule: 'FROM tag one TO all vms ALLOW udp PORT 56',
                enabled: true
            }
        },

        o4: {
            allToOne: {
                owner_uuid: OWNERS[4],
                rule: 'FROM all vms TO tag one BLOCK udp PORT 57',
                enabled: true
            }
        },

        o5: {
            allToOne: {
                owner_uuid: OWNERS[5],
                rule: 'FROM all vms TO tag one ALLOW udp PORT 58',
                enabled: true
            }
        }
    };

    for (r in RULES.o0) {
        RULES.o0[r] = {
            enabled: true,
            owner_uuid: OWNERS[0],
            rule: RULES.o0[r].rule
        };
    }

    for (var o in RULES) {
        for (r in RULES[o]) {
            rules.push(RULES[o][r]);
        }
    }

    async.forEachSeries(rules, function (rule, cb) {
        mod_rule.createAndGet(t, {
            rule: rule,
            exp: rule
        }, cb);
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
            rules: [ RULES.o0.otherToRole, RULES.o0.vm0ToRoleWeb,
                RULES.o0.fooToRoleWeb, RULES.o0.vm1ToRoleOther,
                RULES.o0.nowThenToRoleOther ],
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
            rules: [ RULES.o0.otherToRole, RULES.o0.vm0ToRoleWeb,
                RULES.o0.fooToRoleWeb ],
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
            rules: [ RULES.o0.otherToRole, RULES.o0.vm1ToRoleOther,
                RULES.o0.nowThenToRoleOther ],
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
            rules: [ RULES.o1.vm2ToAll ],
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
            rules: [ RULES.o2.oneToAll ],
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
            rules: [ RULES.o3.oneToAll ],
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
            rules: [ RULES.o4.allToOne ],
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
            rules: [ RULES.o4.allToOne ],
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
            rules: [ RULES.o5.allToOne ],
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
            rules: [ RULES.o5.allToOne ],
            tags: { },
            vms: [ ]
        } ],

    [   util.format('OWNERS[0] (%s): tag num', OWNERS[0]),
        {
            owner_uuid: OWNERS[0],
            tags: { num: ['two'] }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [ RULES.o0.numOneToNumTwo ],
            tags: { num: ['one'] },
            vms: [ ]
        } ]

        // XXX: need a test for passing in vms

    ];

    async.forEachSeries(exp, function (data, cb) {
        mod_rule.resolve(t, {
            desc: ': ' + data[0],
            params: data[1],
            exp: data[2]
        }, cb);

    }, function (err) {
        return t.done();
    });
};



// --- Teardown



exports.teardown = function (t) {
    mod_rule.delAllCreated(t);
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports.setup,
        oneTest: runOne,
        teardown: exports.teardown
    };
}
