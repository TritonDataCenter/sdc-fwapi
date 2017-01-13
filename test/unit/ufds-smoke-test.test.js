/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Some simple unit tests that hit /rules endpoints while using a mock
 * UFDS backend.
 *
 * To do a real test of the UFDS code, run the integration tests while
 * FWRULE_VERSION is set to 2. (Note that some will fail due to issues
 * with using UFDS as a backend. These tests have been called out in
 * their test descriptions.)
 */

'use strict';

var test = require('tape');
var h = require('./helpers');
var mocks = require('./mocks');
var util = require('util');


// --- Globals


var FWAPI;
var MORAY;
var RULES = [];
var VMS = [ h.generateVM(), h.generateVM() ];


// --- Setup


test('setup', function (t) {
    h.createClientAndServer({ fwrule_version: 2 }, function (err, res, moray) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        t.ok(moray, 'moray');
        FWAPI = res;
        MORAY = moray;
        t.end();
    });
});


// --- Ping tests


test('Ping FWAPI', function (t) {
    t.plan(3);

    t.test('UFDS online', function (t2) {
        mocks.ufdsConnected = true;
        FWAPI.ping({}, function (err, stats) {
            if (h.ifErr(t2, err, 'ping error')) {
                t2.end();
                return;
            }

            t2.deepEqual(stats, {
                healthy: true,
                services: {
                    fast: 'online',
                    moray: 'online',
                    ufds: 'online'
                },
                status: 'OK'
            }, 'correct status');
            t2.end();
        });
    });

    t.test('UFDS offline', function (t2) {
        mocks.ufdsConnected = false;
        FWAPI.ping({}, function (err, stats) {
            if (h.ifErr(t2, err, 'ping error')) {
                t2.end();
                return;
            }

            t2.deepEqual(stats, {
                healthy: false,
                services: {
                    fast: 'online',
                    moray: 'online',
                    ufds: 'offline'
                },
                status: 'offline'
            }, 'correct status');
            t2.end();
        });
    });

    t.test('UFDS online (w/ "agents")', function (t2) {
        mocks.ufdsConnected = true;
        FWAPI.ping({ agents: true }, function (err, stats) {
            if (h.ifErr(t2, err, 'ping error')) {
                t2.end();
                return;
            }

            t2.deepEqual(stats, {
                healthy: true,
                services: {
                    fast: 'online',
                    moray: 'online',
                    ufds: 'online'
                },
                status: 'OK',
                agents: {
                    connected: [],
                    ping_id: stats.agents.ping_id
                }
            }, 'correct status');
            t2.end();
        });
    });
});


// --- Create tests


test('Add rule 1', function (t) {
    RULES.push({
        enabled: true,
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


test('Add rule 2', function (t) {
    RULES.push({
        enabled: true,
        owner_uuid: VMS[0].owner_uuid,
        rule: 'FROM tag "foo" TO tag "bar" = "\\)" ALLOW tcp PORT 80'
    });

    FWAPI.createRule(RULES[1], function (err, obj, req, res) {
        if (h.ifErr(t, err, 'rule create')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 202, 'status code');
        t.ok(obj.uuid, 'rule has uuid');
        t.ok(obj.version, 'rule has version');
        RULES[1].uuid = obj.uuid;
        RULES[1].version = obj.version;

        t.deepEqual(obj, RULES[1], 'response');
        h.getMorayUpdates(MORAY, function (err2, updates) {
            if (h.ifErr(t, err2, 'getMorayUpdates() error')) {
                t.end();
                return;
            }

            t.deepEqual(updates, [
                h.morayUpdate('fw.add_rule', RULES[1])
            ], 'moray updates');

            FWAPI.getRule(RULES[1].uuid, function (err3, res2) {
                if (h.ifErr(t, err3, 'getRule() error')) {
                    t.end();
                    return;
                }

                t.deepEqual(res2, RULES[1], 'getRule');
                t.end();
            });
        });
    });
});


test('Update rule 1', function (t) {
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


// --- List tests


test('Search for all rules', function (t) {
    FWAPI.listRules({}, function (err, rules, req, res) {
        if (h.ifErr(t, err, 'listRules() error')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(rules, RULES, 'all rules returned');
        t.end();
    });
});


test('Search for rule 1', function (t) {
    function checkResult(t2) {
        return function (err, rules, req, res) {
            if (h.ifErr(t2, err, 'listRules() error')) {
                t2.end();
                return;
            }

            t2.equal(res.statusCode, 200, 'status code');
            t2.deepEqual(rules, [ RULES[0] ], 'all rules returned');
            t2.end();
        };
    }

    t.plan(3);

    t.test('Search for VMS[0]', function (t2) {
        FWAPI.listRules({ vm: VMS[0] }, checkResult(t2));
    });

    t.test('Search for VMS[1]', function (t2) {
        FWAPI.listRules({ vm: VMS[1] }, checkResult(t2));
    });

    t.test('Search for VMS', function (t2) {
        FWAPI.listRules({ vm: VMS }, checkResult(t2));
    });
});


test('Search for rule 2', function (t) {
    function checkResult(t2) {
        return function (err, rules, req, res) {
            if (h.ifErr(t2, err, 'listRules() error')) {
                t2.end();
                return;
            }

            t2.equal(res.statusCode, 200, 'status code');
            t2.deepEqual(rules, [ RULES[1] ], 'all rules returned');
            t2.end();
        };
    }

    t.plan(3);

    t.test('Search for VMS[0]', function (t2) {
        FWAPI.listRules({ tag: 'foo' }, checkResult(t2));
    });

    t.test('Search for VMS[1]', function (t2) {
        FWAPI.listRules({ tag: 'bar' }, checkResult(t2));
    });

    t.test('Search for VMS', function (t2) {
        FWAPI.listRules({ tag: [ 'foo', 'bar' ] }, checkResult(t2));
    });
});


// --- Delete tests


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
