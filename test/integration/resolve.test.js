/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Unit tests for /resolve endpoint
 */

'use strict';

var test = require('tape');
var assert = require('assert-plus');
var fmt = require('util').format;
var mod_rule = require('../lib/rule');
var mod_uuid = require('node-uuid');
var vasync = require('vasync');



// --- Globals



var NUM_OWNERS = 6;
var NUM_VMS = 7;
var OWNERS = [];
var O_STR = [];
var RULES = {};
var VMS = [];
for (var vi = 0; vi < NUM_VMS; vi++) {
    VMS.push(mod_uuid.v4());
}
VMS.sort();


// Create the owner strings (used to name tests to make debugging easier):
for (var oi = 0; oi <= NUM_OWNERS; oi++) {
    var oUUID = mod_uuid.v4();
    OWNERS.push(oUUID);
    O_STR.push(fmt('OWNERS[%d] (%s): ', oi, oUUID));
}



// --- Helpers



/**
 * Get the named rules out of the RULES object
 */
function oRules(ownerNum, names) {
    var ownRules = RULES['o' + ownerNum.toString()];
    assert.object(ownRules, fmt('rules object for owner %d', ownerNum));

    var rules = [];
    for (var n in names) {
        var rule = ownRules[names[n]];
        assert.object(rule, fmt('rule object %d.%s', ownerNum, names[n]));
        rules.push(rule);
    }

    return rules;
}



// --- Setup



test('setup', function (t) {
    var r;
    var rules = [];
    RULES = {
        o0: {
            unicodeRole: {
                rule: 'FROM (tag "☂" = "ທ" OR tag "삼겹살" = "불고기") '
                    + 'TO ip 8.8.8.8 BLOCK udp PORT 53'
            },
            escapedTag1: {
                rule: 'FROM (tag "[" = "*" OR tag "]" = "=") '
                    + 'TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            escapedTag2: {
                rule: 'FROM (tag "*" = "=" OR tag "\\\\") '
                    + 'TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            escapedTag3: {
                rule: 'FROM (tag "\\"" = "*" OR tag "=" = "a") '
                    + 'TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            escapedTag4: {
                rule: 'FROM tag "=" = "*" '
                    + 'TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            escapedTag5: {
                rule: 'FROM tag "<=" = "*" '
                    + 'TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            escapedTag6: {
                rule: 'FROM tag "<=" = "\\)" '
                    + 'TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            escapedTag7: {
                rule: 'FROM tag "\\(" = "\\(" '
                    + 'TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            commaTag: {
                rule: 'FROM tag "foo,other" TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            ampersandTag: {
                rule: 'FROM tag "foo&other" TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            dotTag: {
                rule: 'FROM tag "foo.other" TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            pipeTag: {
                rule: 'FROM tag "foo|other" TO ip 8.8.8.8 BLOCK tcp PORT 80'
            },
            hopTag1: {
                rule: 'FROM tag "hasOwnProperty" TO ip 8.8.8.8 BLOCK '
                    + 'tcp PORT 80'
            },
            hopTag2: {
                rule: 'FROM tag "quux" = "hasOwnProperty" TO ip 8.8.8.8 BLOCK '
                    + 'tcp PORT 80'
            },
            otherToRole: {
                rule: 'FROM tag "other" TO tag "role" ALLOW tcp PORT 5432'
            },
            vm0ToRoleWeb: {
                rule: fmt(
                    'FROM vm %s TO tag "role" = "web" ALLOW tcp PORT 80',
                    VMS[0])
            },
            fooToRoleWeb: {
                rule: 'FROM (tag "foo" = "bar" OR tag "foo" = "baz") '
                    + 'TO tag "role" = "web" ALLOW tcp PORT 5433'
            },
            vm1ToRoleOther: {
                rule: fmt(
                    'FROM vm %s TO tag "role" = "other" ALLOW tcp PORT 81',
                    VMS[1])
            },
            nowThenToRoleOther: {
                rule: 'FROM tag "now" = "then" TO tag "role" = "other" ALLOW '
                    + 'tcp PORT 82'
            },
            numOneToNumTwo: {
                rule: 'FROM tag "num" = "one" TO tag "num" = "two" ALLOW '
                    + 'tcp PORT 55'
            }
        },

        o1: {
            vm2ToAll: {
                owner_uuid: OWNERS[1],
                rule: fmt('FROM vm %s TO all vms BLOCK udp PORT 54',
                    VMS[2]),
                enabled: true
            }
        },

        o2: {
            oneToAll: {
                owner_uuid: OWNERS[2],
                rule: 'FROM tag "one" TO all vms BLOCK udp PORT 55',
                enabled: true
            }
        },

        o3: {
            oneToAll: {
                owner_uuid: OWNERS[3],
                rule: 'FROM tag "one" TO all vms ALLOW udp PORT 56',
                enabled: true
            }
        },

        o4: {
            allToOne: {
                owner_uuid: OWNERS[4],
                rule: 'FROM all vms TO tag "one" BLOCK udp PORT 57',
                enabled: true
            }
        },

        o5: {
            allToOne: {
                owner_uuid: OWNERS[5],
                rule: 'FROM all vms TO tag "one" ALLOW udp PORT 58',
                enabled: true
            }
        },

        o6: {
            vmToOne: {
                owner_uuid: OWNERS[6],
                rule: fmt('FROM vm %s TO tag "one" ALLOW udp PORT 59', VMS[4]),
                enabled: true
            },

            vmToOneTwo: {
                owner_uuid: OWNERS[6],
                rule: fmt('FROM vm %s TO tag "one" = "two" ALLOW udp PORT 59',
                    VMS[4]),
                enabled: true
            },

            vmToOneThree: {
                owner_uuid: OWNERS[6],
                rule: 'FROM any TO tag "one" = "three" ALLOW udp PORT 59',
                enabled: true
            },

            vmToMultiTags: {
                owner_uuid: OWNERS[6],
                rule: fmt('FROM vm %s TO '
                    + '(tag "five" = "six" OR tag "three" = "four") '
                    + 'ALLOW udp PORT 58', VMS[3]),
                enabled: true
            },

            ipToVm5: {
                owner_uuid: OWNERS[6],
                rule: fmt('FROM ip 10.1.2.5 TO vm %s ALLOW tcp PORT 80',
                    VMS[5]),
                enabled: true
            },

            vm6ToIp: {
                owner_uuid: OWNERS[6],
                rule: fmt('FROM vm %s TO ip 10.1.2.5 BLOCK tcp PORT 80',
                    VMS[6]),
                enabled: true
            },

            vmsOnBothSides: {
                owner_uuid: OWNERS[6],
                rule: fmt('FROM (ip 10.1.2.5 OR vm %s OR vm %s) TO '
                    + '(ip 10.1.2.5 OR vm %s OR vm %s) ALLOW udp PORT 5432',
                    VMS[5], VMS[6], VMS[5], VMS[6]),
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

    vasync.forEachPipeline({
        inputs: rules,
        func: function (rule, cb) {
            mod_rule.createAndGet(t, {
                rule: rule,
                exp: rule
            }, cb);
        }
    }, function (err) {
        t.ifError(err, 'All creates and gets should succeed');
        t.end();
    });
});


test('resolve', function (t) {
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
            rules: oRules(0, [ 'otherToRole', 'vm0ToRoleWeb', 'fooToRoleWeb',
                'vm1ToRoleOther', 'nowThenToRoleOther']),
            tags: { other: true, foo: ['bar', 'baz'], now: ['then'] },
            vms: [ VMS[0], VMS[1] ].sort()
        } ],

    [   'role = web',
        {
            owner_uuid: OWNERS[0],
            tags: { role: 'web' }
        },
        // When resolving tag key = value, we want 2 types of rules:
        // 1) those that reference key = value explicitly
        // 2) those that reference just the key (eg: all keys with name "key",
        //    regardless of their values)
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [
                // Type 1 above:
                'vm0ToRoleWeb',
                'fooToRoleWeb',
                // Type 2 above:
                'otherToRole' ]),
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
            rules: oRules(0, [ 'otherToRole', 'vm1ToRoleOther',
                'nowThenToRoleOther' ]),
            tags: { other: true, now: ['then'] },
            vms: [ VMS[1] ]
        } ],

    [   O_STR[1] + 'vm to all VMs',
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

    [   O_STR[2] + 'tag does_not_exist',
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

    [   O_STR[3] + 'tag one',
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

    [   O_STR[4] + 'tag does_not_exist',
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

    [   O_STR[4] + 'tag one',
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

    [   O_STR[5] + 'tag does_not_exist',
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

    [   O_STR[5] + 'tag one',
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

    [   O_STR[0] + 'tag num=two',
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
        } ],

    [   fmt('%sVM 0 (%s)', O_STR[0], VMS[0]),
        {
            owner_uuid: OWNERS[0],
            vms: [ VMS[0] ]
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [ RULES.o0.vm0ToRoleWeb ],
            // role=web matches, but it's on the TO side of an ALLOW rule,
            // so it doesn't get included
            tags: { },
            vms: [ ]
        } ],

    [   O_STR[0] + 'tag foo=bar',
        {
            owner_uuid: OWNERS[0],
            tags: { foo: 'bar' }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [ RULES.o0.fooToRoleWeb ],
            // role=web matches, but it's on the TO side of an ALLOW rule,
            // so it doesn't get included
            tags: { },
            vms: [ ]
        } ],

    [   O_STR[0] + 'tag foo=baz',
        {
            owner_uuid: OWNERS[0],
            tags: { foo: 'baz' }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [ RULES.o0.fooToRoleWeb ],
            // role=web matches, but it's on the TO side of an ALLOW rule,
            // so it doesn't get included
            tags: { },
            vms: [ ]
        } ],

    [   O_STR[0] + 'tag foo=other',
        {
            owner_uuid: OWNERS[0],
            tags: { foo: 'other' }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [ ],
            tags: { },
            vms: [ ]
        } ],

    [   O_STR[6] + 'tag three=four',
        {
            owner_uuid: OWNERS[6],
            tags: { three: 'four' }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[6],
            rules: [ RULES.o6.vmToMultiTags ],
            tags: { },
            vms: [ VMS[3] ]
        } ],

    [   O_STR[6] + 'tag three',
        {
            owner_uuid: OWNERS[6],
            tags: { three: true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[6],
            rules: oRules(6, [ 'vmToMultiTags' ]),
            tags: { },
            vms: [ VMS[3] ]
        } ],

    [   O_STR[6] + 'tag five=six',
        {
            owner_uuid: OWNERS[6],
            tags: { five: 'six' }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[6],
            rules: [ RULES.o6.vmToMultiTags ],
            tags: { },
            vms: [ VMS[3] ]
        } ],

    [   O_STR[6] + 'tag five',
        {
            owner_uuid: OWNERS[6],
            tags: { five: true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[6],
            rules: [ RULES.o6.vmToMultiTags ],
            tags: { },
            vms: [ VMS[3] ]
        } ],

    [   O_STR[0] + 'escaped tags 1',
        {
            owner_uuid: OWNERS[0],
            tags: { '[': true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [ RULES.o0.escapedTag1 ],
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'escaped tags 2',
        {
            owner_uuid: OWNERS[0],
            tags: { '*': true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [ RULES.o0.escapedTag2 ],
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'escaped tags 3 (fails on UFDS: quote not stored unescaped)',
        {
            owner_uuid: OWNERS[0],
            tags: { '"': true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: [ RULES.o0.escapedTag3 ],
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'escaped tags 3 & 4 (fails on UFDS: query finds extra rule)',
        {
            owner_uuid: OWNERS[0],
            tags: { '=': true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'escapedTag3', 'escapedTag4' ]),
            tags: { },
            vms: []
        } ],


    [   O_STR[0] + 'escaped tags 4 (fails on UFDS: query finds 2 extra rules)',
        {
            owner_uuid: OWNERS[0],
            tags: { '=': [ '*' ] }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'escapedTag4' ]),
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'escaped tags 5',
        {
            owner_uuid: OWNERS[0],
            tags: { '<=': [ '*' ] }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'escapedTag5' ]),
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'escaped tags 6 (fails on UFDS: paren not stored unescaped)',
        {
            owner_uuid: OWNERS[0],
            tags: { '<=': [ ')' ] }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'escapedTag6' ]),
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'escaped tags 7 (fails on UFDS: paren not stored unescaped)',
        {
            owner_uuid: OWNERS[0],
            tags: { '(': [ '(' ] }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'escapedTag7' ]),
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'tag with comma',
        {
            owner_uuid: OWNERS[0],
            tags: { 'foo,other': true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'commaTag' ]),
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'tag with ampersand',
        {
            owner_uuid: OWNERS[0],
            tags: { 'foo&other': true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'ampersandTag' ]),
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'tag with dot',
        {
            owner_uuid: OWNERS[0],
            tags: { 'foo.other': true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'dotTag' ]),
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'tag with pipe',
        {
            owner_uuid: OWNERS[0],
            tags: { 'foo|other': true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'pipeTag' ]),
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'tag name "hasOwnProperty"',
        {
            owner_uuid: OWNERS[0],
            tags: { 'hasOwnProperty': true }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'hopTag1' ]),
            tags: { },
            vms: []
        } ],

    [   O_STR[0] + 'tag value "hasOwnProperty"',
        {
            owner_uuid: OWNERS[0],
            tags: { 'quux': 'hasOwnProperty' }
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[0],
            rules: oRules(0, [ 'hopTag2' ]),
            tags: { },
            vms: []
        } ],

    [   fmt('%sVM 5 (%s)', O_STR[0], VMS[5]),
        {
            owner_uuid: OWNERS[6],
            vms: [ VMS[5] ]
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[6],
            rules: [ RULES.o6.ipToVm5, RULES.o6.vmsOnBothSides ],
            tags: { },
            vms: [ VMS[5], VMS[6] ]
        } ],

    [   fmt('%sVM 6 (%s)', O_STR[0], VMS[6]),
        {
            owner_uuid: OWNERS[6],
            vms: [ VMS[6] ]
        },
        {
            allVMs: false,
            owner_uuid: OWNERS[6],
            rules: [ RULES.o6.vm6ToIp, RULES.o6.vmsOnBothSides ],
            tags: { },
            vms: [ VMS[5], VMS[6] ]
        } ]
    ];

    vasync.forEachPipeline({
        inputs: exp,
        func: function (data, cb) {
            mod_rule.resolve(t, {
                desc: ': ' + data[0],
                params: data[1],
                exp: data[2]
            }, cb);

        }
    }, function (err) {
        t.ifError(err, 'All queries should resolve');
        t.end();
    });
});


test('list', function (t) {
    var exp = [
    [   { owner_uuid: OWNERS[0], tag: 'other' },
        oRules(0, [ 'otherToRole' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: '[' },
        oRules(0, [ 'escapedTag1' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: ']' },
        oRules(0, [ 'escapedTag1' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: ')' },
        oRules(0, [])
    ],

    [   { owner_uuid: OWNERS[0], tag: '(((' },
        oRules(0, [])
    ],

    [   { owner_uuid: OWNERS[0], tag: ')))' },
        oRules(0, [])
    ],

    [   { owner_uuid: OWNERS[0], tag: '*' },
        oRules(0, [ 'escapedTag2' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: '<=' },
        oRules(0, [ 'escapedTag5', 'escapedTag6' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: 'foo,other' },
        oRules(0, [ 'commaTag' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: 'foo&other' },
        oRules(0, [ 'ampersandTag' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: 'foo.other' },
        oRules(0, [ 'dotTag' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: 'foo|other' },
        oRules(0, [ 'pipeTag' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: 'hasOwnProperty' },
        oRules(0, [ 'hopTag1' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: '☂' },
        oRules(0, [ 'unicodeRole' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: '삼겹살' },
        oRules(0, [ 'unicodeRole' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: 'role' },
        oRules(0, [ 'otherToRole', 'vm0ToRoleWeb', 'fooToRoleWeb',
            'vm1ToRoleOther', 'nowThenToRoleOther' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: 'other' },
        oRules(0, [ 'otherToRole' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: 'foo' },
        [ RULES.o0.fooToRoleWeb ]
    ],

    [   { owner_uuid: OWNERS[0], vm: VMS[0] },
        [ RULES.o0.vm0ToRoleWeb ]
    ],

    [   { owner_uuid: OWNERS[0], vm: VMS[1] },
        [ RULES.o0.vm1ToRoleOther ]
    ],

    [   { owner_uuid: OWNERS[6], vm: VMS[4] },
        oRules(6, [ 'vmToOne', 'vmToOneTwo' ])
    ],

    [   { owner_uuid: OWNERS[6], tag: 'one' },
        oRules(6, [ 'vmToOne', 'vmToOneTwo', 'vmToOneThree' ])
    ]

    ];

    vasync.forEachPipeline({
        inputs: exp,
        func: function (data, cb) {
            mod_rule.list(t, {
                params: data[0],
                exp: data[1]
            }, cb);

        }
    }, function (err) {
        t.ifError(err, 'Querying rules should succeed');
        t.end();
    });
});


test('list (these fail with UFDS)', function (t) {
    var exp = [
    [   { owner_uuid: OWNERS[0], tag: '\\' },
        oRules(0, [ 'escapedTag2' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: '"' },
        oRules(0, [ 'escapedTag3' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: '=' },
        oRules(0, [ 'escapedTag3', 'escapedTag4' ])
    ],

    [   { owner_uuid: OWNERS[0], tag: '(' },
        oRules(0, [ 'escapedTag7' ])
    ]

    ];

    vasync.forEachPipeline({
        inputs: exp,
        func: function (data, cb) {
            mod_rule.list(t, {
                params: data[0],
                exp: data[1]
            }, cb);
        }
    }, function (err) {
        t.ifError(err, 'Querying rules should succeed');
        t.end();
    });
});



// --- Teardown



test('teardown', function (t) {
    mod_rule.delAllCreated(t);
});
