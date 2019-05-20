/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019, Joyent, Inc.
 */

/*
 * Integration tests for global rules
 */

'use strict';

var test = require('tape');
var mod_rule = require('../lib/rule');
var mod_uuid = require('uuid');



// --- Globals



var FORBIDDEN_BODY = {
    code: 'Forbidden',
    message: 'owner does not match',
    errors: [ {
        'field': 'owner_uuid',
        'code': 'InvalidParameter',
        'message': 'owner_uuid does not match'
    } ]
};
var OWNERS = [ mod_uuid.v4() ];
var RULES = [];



// --- Tests



test('Add rule', function (t) {
    RULES.push({
        enabled: true,
        global: true,
        log: false,
        rule: 'FROM any TO all vms ALLOW udp PORT 5000'
    });

    mod_rule.createAndGet(t, {
        rule: RULES[0],
        exp: RULES[0]
    });
});


/*
 * Should not be able to update the rule if owner_uuid is set
 */
test('Update rule when owner_uuid set', function (t) {
    mod_rule.updateAndGet(t, {
        uuid: RULES[0].uuid,
        params: {
            rule: 'FROM any TO all vms ALLOW udp PORT 5000',
            owner_uuid: OWNERS[0]
        },
        expCode: 403,
        expErr: FORBIDDEN_BODY
    });
});


/*
 * Should not be able to delete the rule if owner_uuid is set
 */
test('Delete rule with owner_uuid set', function (t) {
    mod_rule.del(t, {
        uuid: RULES[0].uuid,
        params: {
            owner_uuid: OWNERS[0]
        },
        expCode: 403,
        expErr: FORBIDDEN_BODY
    });
});


test('List global rules', function (t) {
    mod_rule.list(t, {
        params: {
            global: true
        }
    }, function (err, res) {
        if (err) {
            return t.end();
        }

        var nonGlobals = [];
        for (var r in res) {
            var rule = res[r];
            if (!rule.hasOwnProperty('global') || !rule.global) {
                nonGlobals.push(rule);
            }
        }

        t.deepEqual(nonGlobals, [], 'only global rules in the list');
        return t.end();
    });
});



// --- Teardown



test('teardown', function (t) {
    mod_rule.delAllCreated(t);
});
