/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Integration tests for getting rules
 */

'use strict';

var test = require('tape');
var mod_rule = require('../lib/rule');
var mod_uuid = require('node-uuid');



// --- Globals



var OWNERS = [
    mod_uuid.v4(),
    mod_uuid.v4()
];
var RULES = [
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM any TO all vms ALLOW tcp PORT 5000'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[1],
        rule: 'FROM (tag "foo" = "bar" OR tag "foo" = "baz") '
            + 'TO tag "side" = "two" ALLOW tcp (PORT 5003 AND PORT 5004)'
    },
    {
        enabled: true,
        global: true,
        rule: 'FROM any TO tag "foo" = "baz" ALLOW tcp PORT 5010'
    }
];


// --- Tests



test('add all rules', function (t) {
    mod_rule.createAndGetN(t, {
        rules: RULES
    });
});


test('get: owner rule with owner_uuid', function (t) {
    mod_rule.get(t, {
        uuid: RULES[0].uuid,
        params: {
            owner_uuid: OWNERS[0]
        },
        exp: RULES[0]
    });
});


test('get: owner rule with wrong owner_uuid', function (t) {
    mod_rule.get(t, {
        uuid: RULES[0].uuid,
        params: {
            owner_uuid: OWNERS[1]
        },
        expCode: 403,
        expErr: {
            code: 'Forbidden',
            message: 'owner does not match',
            errors: [ {
                field: 'owner_uuid',
                code: 'InvalidParameter',
                message: 'owner_uuid does not match'
            } ]
        }
    });
});


test('get: global rule with no params', function (t) {
    mod_rule.get(t, {
        uuid: RULES[2].uuid,
        exp: RULES[2]
    });
});



// --- Teardown



test('teardown', mod_rule.delAllCreated);
