/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for nic tag endpoints
 */

var helpers = require('./helpers');
var mocks = require('./mocks');
var util = require('util');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var FWAPI;
var RULES = [];
var VMS = [ helpers.generateVM(), helpers.generateVM() ];



// --- Setup



exports.setup = function (t) {
    mocks._VMS = VMS;
    helpers.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        FWAPI = res;
        t.done();
    });
};



// --- Create tests



exports['Add rule'] = function (t) {
    RULES.push({
        enabled: true,
        rule: util.format('FROM vm %s TO vm %s ALLOW tcp PORT 80',
            VMS[0].uuid, VMS[1].uuid)
    });

    FWAPI.createRule(RULES[0], function (err, obj, req, res) {
        t.ifError(err, 'rule create');
        if (err) {
            return t.done();
        }

        t.equal(res.statusCode, 202, 'status code');
        RULES[0].uuid = obj.rule.uuid;
        RULES[0].version = obj.rule.version;
        t.deepEqual(obj, {
            job_uuid: obj.job_uuid,
            rule: RULES[0]
        }, 'response');

        var wfRes = helpers.wfResults()[obj.job_uuid];
        t.deepEqual(wfRes, {
            done: true,
            last: 'cnapi.poll_tasks',
            name: 'fw-add'
        }, 'workflow result');

        var expRules = {};
        expRules[RULES[0].uuid] = RULES[0];

        // XXX: test with another VM on a different server. Make sure the other
        // server does *not* get any rules

        t.ok(mocks._SERVERS[VMS[0].server_uuid], 'mock server entry exists');
        if (mocks._SERVERS[VMS[0].server_uuid]) {
            t.deepEqual(mocks._SERVERS[VMS[0].server_uuid].rules, expRules,
                'rules propagated to server');
        }

        FWAPI.getRule(RULES[0].uuid, function (err2, res2) {
            t.ifError(err2, 'getRule error');
            if (err2) {
                return t.done();
            }

            t.deepEqual(res2, RULES[0], 'getRule');
            return t.done();
        });
    });
};


exports['Update rule'] = function (t) {
    var payload = {
        rule: util.format('FROM vm %s TO vm %s ALLOW tcp (PORT 80 AND PORT 81)',
            VMS[0].uuid, VMS[1].uuid)
    };
    RULES[0].rule = payload.rule;

    FWAPI.updateRule(RULES[0].uuid, payload, function (err, obj, req, res) {
        t.ifError(err, 'rule update');
        if (err) {
            return t.done();
        }

        t.equal(res.statusCode, 202, 'status code');
        t.ok(obj.version !== RULES[0].version, 'version updated');
        RULES[0].version = obj.rule.version;
        t.deepEqual(obj, {
            job_uuid: obj.job_uuid,
            rule: RULES[0]
        }, 'response');

        var wfRes = helpers.wfResults()[obj.job_uuid];
        t.deepEqual(wfRes, {
            done: true,
            last: 'cnapi.poll_tasks',
            name: 'fw-update'
        }, 'workflow result');

        var expRules = {};
        expRules[RULES[0].uuid] = RULES[0];

        if (mocks._SERVERS[VMS[0].server_uuid]) {
            t.deepEqual(mocks._SERVERS[VMS[0].server_uuid].rules, expRules,
                'rules propagated to server');
        }

        FWAPI.getRule(RULES[0].uuid, function (err2, res2) {
            t.ifError(err2, 'getRule error');
            if (err2) {
                return t.done();
            }

            t.deepEqual(res2, RULES[0], 'getRule');
            return t.done();
        });
    });
};


exports['Delete rule'] = function (t) {
    FWAPI.deleteRule(RULES[0].uuid, function (err, obj, req, res) {
        t.ifError(err, 'rule delete');
        if (err) {
            return t.done();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.ok(obj.job_uuid, 'job_uuid');

        var wfRes = helpers.wfResults()[obj.job_uuid];
        t.deepEqual(wfRes, {
            done: true,
            last: 'ufds.del_rule',
            name: 'fw-del'
        }, 'workflow result');

        if (mocks._SERVERS[VMS[0].server_uuid]) {
            t.deepEqual(mocks._SERVERS[VMS[0].server_uuid].rules, {},
                'rule deleted from server');
        }

        FWAPI.getRule(RULES[0].uuid, function (err2, res2) {
            t.ok(err2, 'getRule error');
            if (!err2) {
                return t.done();
            }

            t.deepEqual(err2.body, {
                code: 'ResourceNotFound',
                message: 'Rule not found'
            }, 'error body');

            return t.done();
        });
    });
};



// --- Teardown



exports['Stop server'] = function (t) {
    helpers.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.done();
    });
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports.setup,
        setUp: exports.setUp,
        oneTest: runOne,
        teardown: exports['Stop server']
    };
}
