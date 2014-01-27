/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Integration tests for global rules
 */

var async = require('async');
var h = require('./helpers');
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
var FWAPI;
var OWNERS = [ mod_uuid.v4() ];
var RULES = [];



// --- Setup



exports.setup = function (t) {
    FWAPI = h.createClient();
    t.done();
};



// --- Create tests



exports['Add rule'] = function (t) {
    RULES.push({
        enabled: true,
        global: true,
        rule: 'FROM any TO all vms ALLOW udp PORT 5000'
    });

    FWAPI.createRule(RULES[0], function (err, obj, req, res) {
        if (h.ifErr(t, err, 'rule create: ' + RULES[0].rule)) {
            return t.done();
        }

        t.equal(res.statusCode, 202, 'status code');
        t.ok(obj.uuid, 'rule has uuid');
        t.ok(obj.version, 'rule has version');
        RULES[0].uuid = obj.uuid;
        RULES[0].version = obj.version;
        t.deepEqual(obj, RULES[0], 'response');

        FWAPI.getRule(RULES[0].uuid, function (err2, res2) {
            if (h.ifErr(t, err2, 'get rule: ' + RULES[0].uuid)) {
                return t.done();
            }

            t.deepEqual(res2, RULES[0], 'getRule');
            return t.done();
        });
    });
};


exports['Update rule when owner_uuid set'] = function (t) {
    // Should not be able to update the rule if owner_uuid is set
    var payload = {
        rule: 'FROM any TO all vms ALLOW udp PORT 5000',
        owner_uuid: OWNERS[0]
    };

    FWAPI.updateRule(RULES[0].uuid, payload, function (err, obj, req, res) {
        t.ok(err, 'error returned');
        t.equal(res.statusCode, 403, 'error status code');
        if (!err) {
            return t.done();
        }

        t.deepEqual(err.body, FORBIDDEN_BODY, 'error body');
        return t.done();
    });
};


exports['Delete rule with owner_uuid set'] = function (t) {
    // Should not be able to delete the rule if owner_uuid is set
    var payload = {
        owner_uuid: OWNERS[0]
    };

    FWAPI.deleteRule(RULES[0].uuid, payload, function (err, obj, req, res) {
        t.ok(err, 'error returned');
        t.equal(res.statusCode, 403, 'error status code');
        if (!err) {
            return t.done();
        }

        t.deepEqual(err.body, FORBIDDEN_BODY, 'error body');
        return t.done();
    });
};



// --- Teardown



exports.teardown = function (t) {
    h.deleteRules(t, FWAPI, RULES, function () {
        return t.done();
    });
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
