/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Unit tests for /rules endpoints
 */

var test = require('tape');
var h = require('./helpers');
var mocks = require('./mocks');
var util = require('util');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var FWAPI;
var RULES = [];
var VMS = [ h.generateVM(), h.generateVM() ];



// --- Setup



test('setup', function (t) {
    h.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        FWAPI = res;
        t.end();
    });
});



// --- Create ts



test('Add rule', function (t) {
    RULES.push({
        enabled: true,
        owner_uuid: VMS[0].owner_uuid,
        rule: util.format('FROM vm %s TO vm %s ALLOW tcp PORT 80',
            VMS[0].uuid, VMS[1].uuid)
    });

    FWAPI.createRule(RULES[0], function (err, obj, req, res) {
        t.ifError(err, 'rule create');
        if (err) {
            return t.end();
        }

        t.equal(res.statusCode, 202, 'status code');
        t.ok(obj.uuid, 'rule has uuid');
        t.ok(obj.version, 'rule has version');
        RULES[0].uuid = obj.uuid;
        RULES[0].version = obj.version;

        t.deepEqual(obj, RULES[0], 'response');
        t.deepEqual(h.getMorayUpdates(), [
            h.morayUpdate('fw.add_rule', RULES[0])
        ], 'moray updates');

        FWAPI.getRule(RULES[0].uuid, function (err2, res2) {
            t.ifError(err2, 'getRule error');
            if (err2) {
                return t.end();
            }

            t.deepEqual(res2, RULES[0], 'getRule');
            return t.end();
        });
    });
});


test('Update rule', function (t) {
    var payload = {
        rule: util.format('FROM vm %s TO vm %s ALLOW tcp (PORT 80 AND PORT 81)',
            VMS[0].uuid, VMS[1].uuid)
    };
    RULES[0].rule = payload.rule;

    FWAPI.updateRule(RULES[0].uuid, payload, function (err, obj, req, res) {
        t.ifError(err, 'rule update');
        if (err) {
            return t.end();
        }

        t.equal(res.statusCode, 202, 'status code');
        t.ok(obj.version !== RULES[0].version, 'version updated');
        RULES[0].version = obj.version;

        t.deepEqual(obj, RULES[0], 'response');
        t.deepEqual(h.getMorayUpdates(), [
            h.morayUpdate('fw.update_rule', RULES[0])
        ], 'moray updates');

        FWAPI.getRule(RULES[0].uuid, function (err2, res2) {
            t.ifError(err2, 'getRule error');
            if (err2) {
                return t.end();
            }

            t.deepEqual(res2, RULES[0], 'getRule');
            return t.end();
        });
    });
});


test('Delete rule', function (t) {
    FWAPI.deleteRule(RULES[0].uuid, function (err, obj, req, res) {
        t.ifError(err, 'rule delete');
        if (err) {
            return t.end();
        }

        t.equal(res.statusCode, 204, 'status code');

        t.deepEqual(h.getMorayUpdates(), [
            h.morayUpdate('fw.del_rule', RULES[0])
        ], 'moray updates');

        FWAPI.getRule(RULES[0].uuid, function (err2, res2) {
            t.ok(err2, 'getRule error');
            if (!err2) {
                return t.end();
            }

            t.deepEqual(err2.body, {
                code: 'ResourceNotFound',
                message: 'Rule not found'
            }, 'error body');

            return t.end();
        });
    });
});



// --- Teardown



test('Stop server', function (t) {
    h.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.end();
    });
});
