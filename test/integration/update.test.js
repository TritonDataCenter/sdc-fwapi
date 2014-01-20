/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Update tests for /rules endpoints
 */

var async = require('async');
var h = require('./helpers');
var mod_uuid = require('node-uuid');
var util = require('util');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
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
        owner_uuid: OWNERS[0],
        rule: 'FROM all vms TO tag test BLOCK tcp PORT 8000'
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


exports['Update rule'] = function (t) {
    var exp = [
    [
        'remove all vms',
        {
            rule: 'FROM ip 10.0.0.1 TO tag test BLOCK '
                + 'tcp PORT 8000'
        }

    ], [
        'add 2 IPs',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.2 OR ip 10.0.0.3) TO '
                + 'tag test BLOCK tcp PORT 8000'
        }

    ], [
        'remove 1 IP',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + 'tag test BLOCK tcp PORT 8000'
        }

    ], [
        'add a tag',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + '(tag test OR tag test2) BLOCK tcp PORT 8000'
        }

    ], [
        'add a value to a tag',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + '(tag test OR tag test2 = foo) BLOCK tcp PORT 8000'
        }

    ], [
        'add another value to a tag',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + '(tag test OR tag test2 = foo OR tag test2 = foo2) '
                + 'BLOCK tcp PORT 8000'
        }

    ], [
        'remove a tag and value',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + 'tag test BLOCK tcp PORT 8000'
        }

    ], [
        'replace a tag with all vms',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + 'all vms BLOCK tcp PORT 8000'
        }
    ]
    ];

    async.forEachSeries(exp, function (data, cb) {
        var desc = ': ' + data[0];
        var payload = data[1];

        FWAPI.updateRule(RULES[0].uuid, payload, function (err, obj, req, res) {
            if (h.ifErr(t, err, 'update' + desc)) {
                t.equal(payload.rule, RULES[0].rule, 'rule' + desc);
                return cb(err);
            }

            t.equal(res.statusCode, 202, 'status code' + desc);
            t.ok(obj.version !== RULES[0].version, 'version updated'+ desc);
            RULES[0].version = obj.version;
            RULES[0].rule = payload.rule;

            t.deepEqual(obj, RULES[0], 'response' + desc);

            FWAPI.getRule(RULES[0].uuid, function (err2, res2) {
                if (h.ifErr(t, err2, 'get' + desc)) {
                    return cb(err);
                }

                t.deepEqual(res2, RULES[0], 'getRule' + desc);
                return cb();
            });
        });

    }, function () {
        return t.done();
    });
};



// --- Teardown



exports.teardown = function (t) {
    async.forEachSeries(RULES, function (rule, cb) {
        var desc = ': ' + rule.rule;
        FWAPI.deleteRule(rule.uuid, function (err, obj, req, res) {
            t.ifError(err, 'rule delete' + desc);
            if (err) {
                return cb(err);
            }

            t.equal(res.statusCode, 204, 'status code' + desc);

            FWAPI.getRule(RULES[0].uuid, function (err2, res2) {
                t.ok(err2, 'getRule error' + desc);
                if (!err2) {
                    return cb(err2);
                }

                t.deepEqual(err2.body, {
                    code: 'ResourceNotFound',
                    message: 'Rule not found'
                }, 'error body' + desc);

                return cb();
            });
        });

    }, function () {
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
