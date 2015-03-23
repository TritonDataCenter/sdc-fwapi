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

var async = require('async');
var h = require('./helpers');
var mod_rule = require('../lib/rule');
var mod_uuid = require('node-uuid');
var util = require('util');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var OWNERS = [
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
    }
];



// --- Tests



exports['Add rules'] = {

    'rule 0': function (t) {
        mod_rule.createAndGet(t, {
            rule: RULES[0],
            exp: RULES[0]
        });
    },

    'rule 1': function (t) {
        mod_rule.createAndGet(t, {
            rule: RULES[1],
            exp: RULES[1]
        });
    },

    'rule 2': function (t) {
        mod_rule.createAndGet(t, {
            rule: RULES[2],
            exp: RULES[2]
        });
    },

    'rule 3': function (t) {
        mod_rule.createAndGet(t, {
            rule: RULES[3],
            exp: RULES[3]
        });
    }

};


exports['List: subnet 10.2.1.0/24'] = function (t) {
    mod_rule.list(t, {
        params: {
            subnet: '10.2.1.0/24'
        },
        exp: [
            RULES[1],
            RULES[2]
        ]
    });
};


exports['List: subnet 10.3.1.0/24'] = function (t) {
    mod_rule.list(t, {
        params: {
            subnet: '10.3.1.0/24'
        },
        exp: [
            RULES[3]
        ]
    });
};



// --- Teardown



exports.teardown = mod_rule.delAllCreated;



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports.setup,
        setUp: exports.setUp,
        oneTest: runOne,
        teardown: exports.teardown
    };
}
