/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Integration tests for listing rules
 */

'use strict';

var test = require('tape');
var constants = require('../../lib/util/constants');
var extend = require('xtend');
var mod_rule = require('../lib/rule');
var mod_uuid = require('uuid');



// --- Globals



var OWNERS = [
    mod_uuid.v4(),
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
        rule: 'FROM tag "foo" TO all vms BLOCK udp PORT all'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[1],
        rule: 'FROM (tag "foo" = "bar" OR tag "foo" = "baz") '
            + 'TO tag "side" = "two" ALLOW tcp (PORT 5003 AND PORT 5004)'
    },

    // OWNERS[2]

    {
        enabled: true,
        owner_uuid: OWNERS[2],
        rule: 'FROM any TO all vms ALLOW ah'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[2],
        rule: 'FROM any TO all vms ALLOW esp'
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

test('list: all ports', function (t) {
    mod_rule.createAndGet(t, {
        rule: {
            enabled: true,
            owner_uuid: OWNERS[2],
            rule: 'FROM tag "foo" TO all vms BLOCK udp PORTS 1 - 200, 1 - 65535'
        },
        exp: {
            enabled: true,
            owner_uuid: OWNERS[2],
            rule: 'FROM tag "foo" TO all vms BLOCK udp PORT all'
        }
    }, function (err) {
        t.ifError(err, 'creating range of all ports should be successful');
        t.end();
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


test('list: IPsec protocols', function (t) {
    t.plan(2);

    t.test('list: IPsec protocols - AH', function (t2) {
        mod_rule.list(t2, {
            params: {
                owner_uuid: OWNERS[2],
                protocol: 'ah'
            },
            exp: [
                RULES[7]
            ]
        });
    });

    t.test('list: IPsec protocols - ESP', function (t2) {
        mod_rule.list(t2, {
            params: {
                owner_uuid: OWNERS[2],
                protocol: 'esp'
            },
            exp: [
                RULES[8]
            ]
        });
    });
});


// --- Teardown



test('teardown', mod_rule.delAllCreated);
