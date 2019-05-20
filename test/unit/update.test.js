/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Unit tests for /rules endpoints
 */

'use strict';

var test = require('tape');
var h = require('./helpers');
var util = require('util');



// --- Globals



var FWAPI;
var MORAY;
var RULES = [];
var VMS = [ h.generateVM(), h.generateVM() ];



// --- Setup



test('setup', function (t) {
    h.createClientAndServer({}, function (err, res, moray) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        t.ok(moray, 'moray');
        FWAPI = res;
        MORAY = moray;
        t.end();
    });
});



// --- Create ts



test('Add rule', function (t) {
    RULES.push({
        enabled: true,
        log: false,
        owner_uuid: VMS[0].owner_uuid,
        rule: util.format('FROM vm %s TO vm %s ALLOW tcp PORT 80',
            VMS[0].uuid, VMS[1].uuid)
    });

    FWAPI.createRule(RULES[0], function (err, obj, req, res) {
        if (h.ifErr(t, err, 'rule create')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 202, 'status code');
        t.ok(obj.uuid, 'rule has uuid');
        t.ok(obj.version, 'rule has version');
        RULES[0].uuid = obj.uuid;
        RULES[0].version = obj.version;

        t.deepEqual(obj, RULES[0], 'response');
        h.getMorayUpdates(MORAY, function (err2, updates) {
            if (h.ifErr(t, err2, 'getMorayUpdates() error')) {
                t.end();
                return;
            }

            t.deepEqual(updates, [
                h.morayUpdate('fw.add_rule', RULES[0])
            ], 'moray updates');

            FWAPI.getRule(RULES[0].uuid, function (err3, res2) {
                if (h.ifErr(t, err3, 'getRule() error')) {
                    t.end();
                    return;
                }

                t.deepEqual(res2, RULES[0], 'getRule');
                t.end();
            });
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
        if (h.ifErr(t, err, 'rule update')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 202, 'status code');
        t.ok(obj.version !== RULES[0].version, 'version updated');
        RULES[0].version = obj.version;

        t.deepEqual(obj, RULES[0], 'response');
        h.getMorayUpdates(MORAY, function (err2, updates) {
            if (h.ifErr(t, err2, 'getMorayUpdates() error')) {
                t.end();
                return;
            }

            t.deepEqual(updates, [
                h.morayUpdate('fw.update_rule', RULES[0])
            ], 'moray updates');

            FWAPI.getRule(RULES[0].uuid, function (err3, res2) {
                if (h.ifErr(t, err3, 'getRule() error')) {
                    t.end();
                    return;
                }

                t.deepEqual(res2, RULES[0], 'getRule');
                t.end();
            });
        });
    });
});


test('Delete rule', function (t) {
    FWAPI.deleteRule(RULES[0].uuid, function (err, _, req, res) {
        if (h.ifErr(t, err, 'rule delete')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 204, 'status code');

        h.getMorayUpdates(MORAY, function (err2, updates) {
            if (h.ifErr(t, err2, 'getMorayUpdates() error')) {
                t.end();
                return;
            }

            t.deepEqual(updates, [
                h.morayUpdate('fw.del_rule', RULES[0])
            ], 'moray updates');

            FWAPI.getRule(RULES[0].uuid, function (err3, res2) {
                t.ok(err3, 'getRule error');
                if (!err3) {
                    t.end();
                    return;
                }

                t.deepEqual(err3.body, {
                    code: 'ResourceNotFound',
                    message: 'Rule not found'
                }, 'error body');

                FWAPI.deleteRule(RULES[0].uuid, function (err4, res3) {
                    t.ok(err4, 'deleteRule error');
                    if (!err4) {
                        t.end();
                        return;
                    }

                    t.deepEqual(err4.body, {
                        code: 'ResourceNotFound',
                        message: 'Rule not found'
                    }, 'error body');

                    t.end();
                });
            });
        });
    });
});


// --- Teardown


test('Stop server', h.stopServer);
