/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Integration tests for global rules
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
var FORBIDDEN_BODY = {
    code : 'Forbidden',
    message : 'owner does not match',
    errors : [ {
        'field' : 'owner_uuid',
        'code' : 'InvalidParameter',
        'message' : 'owner_uuid does not match'
    } ]
};
var OWNERS = [ mod_uuid.v4() ];
var RULES = [];



// --- Tests



exports['Add rule'] = function (t) {
    RULES.push({
        enabled: true,
        global: true,
        rule: 'FROM any TO all vms ALLOW udp PORT 5000'
    });

    mod_rule.createAndGet(t, {
        rule: RULES[0],
        exp: RULES[0]
    });
};


/*
 * Should not be able to update the rule if owner_uuid is set
 */
exports['Update rule when owner_uuid set'] = function (t) {
    mod_rule.updateAndGet(t, {
        uuid: RULES[0].uuid,
        rule: {
            rule: 'FROM any TO all vms ALLOW udp PORT 5000',
            owner_uuid: OWNERS[0]
        },
        expCode: 403,
        expErr: FORBIDDEN_BODY
    });
};


/*
 * Should not be able to delete the rule if owner_uuid is set
 */
exports['Delete rule with owner_uuid set'] = function (t) {
    mod_rule.del(t, {
        uuid: RULES[0].uuid,
        params: {
            owner_uuid: OWNERS[0]
        },
        expCode: 403,
        expErr: FORBIDDEN_BODY
    });
};


exports['List global rules'] = function (t) {
    mod_rule.list(t, {
        params: {
            global: true
        }
    }, function (err, res) {
        if (err) {
            return t.done();
        }

        var nonGlobals = [];
        for (var r in res) {
            var rule = res[r];
            if (!rule.hasOwnProperty('global') || !rule.global) {
                nonGlobals.push(rule);
            }
        }

        t.deepEqual(nonGlobals, [], 'only global rules in the list');
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
        setUp: exports.setUp,
        oneTest: runOne,
        teardown: exports.teardown
    };
}
