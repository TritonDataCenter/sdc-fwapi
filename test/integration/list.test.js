/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Integration tests for listing rules
 */

var test = require('tape');
var async = require('async');
var constants = require('../../lib/util/constants');
var extend = require('xtend');
var h = require('./helpers');
var mod_rule = require('../lib/rule');
var mod_uuid = require('node-uuid');
var util = require('util');



// --- Globals



var OWNERS = [
    mod_uuid.v4(),
    mod_uuid.v4()
];
var RULES = [
    // Add another rule for this user to make sure we're not return all
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM any TO all vms ALLOW tcp PORT 5000'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM all vms TO subnet 10.2.1.0/24 ALLOW tcp PORT 5001'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM subnet 10.2.1.0/24 TO all vms ALLOW tcp PORT 5002'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM subnet 10.3.1.0/24 TO all vms ALLOW tcp PORT 5002'
    },

    // OWNERS[1]

    {
        enabled: true,
        owner_uuid: OWNERS[1],
        rule: 'FROM subnet 10.2.1.0/24 TO all vms ALLOW tcp PORT 5001'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[1],
        rule: 'FROM tag foo TO all vms BLOCK udp PORT all'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[1],
        rule: 'FROM (tag foo = bar OR tag foo = baz) '
            + 'TO tag side = two ALLOW tcp (PORT 5003 AND PORT 5004)'
    }
];



// --- Tests



test('add all rules', function (t) {
    mod_rule.createAndGetN(t, {
        rules: RULES
    });
});


test('list: subnet 10.2.1.0/24', function (t) {
    mod_rule.list(t, {
        params: {
            owner_uuid: OWNERS[0],
            subnet: '10.2.1.0/24'
        },
        exp: [
            RULES[1],
            RULES[2]
            // Should *not* match RULES[4], which is owned by OWNERS[1]
        ]
    });
});


test('list: subnet 10.3.1.0/24', function (t) {
    mod_rule.list(t, {
        params: {
            owner_uuid: OWNERS[0],
            subnet: '10.3.1.0/24'
        },
        exp: [
            RULES[3]
        ]
    });
});


test('list: parsed fields', function (t) {
    mod_rule.list(t, {
        params: {
            owner_uuid: OWNERS[1],
            fields: constants.PARSED_FIELDS
        },
        exp: [
            extend(RULES[4], {
                parsed: {
                    action: 'allow',
                    fromtags: {},
                    protocol: 'tcp',
                    ports: [ 5001 ],
                    totags: {}
                }
            }),
            extend(RULES[5], {
                parsed: {
                    action: 'block',
                    fromtags: {
                        foo: {
                            all: true,
                            values: []
                        }
                    },
                    protocol: 'udp',
                    ports: [ 'all' ],
                    totags: {}
                }
            }),
            extend(RULES[6], {
                parsed: {
                    action: 'allow',
                    fromtags: {
                        foo: {
                            all: false,
                            values: [ 'bar', 'baz' ]
                        }
                    },
                    protocol: 'tcp',
                    ports: [ 5003, 5004 ],
                    totags: {
                        side: {
                            all: false,
                            values: [ 'two' ]
                        }
                    }
                }
            })
        ]
    });
});



// --- Teardown



test('teardown', mod_rule.delAllCreated);
