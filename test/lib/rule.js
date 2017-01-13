/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Helpers for manipulating FWAPI rules
 */

'use strict';

var assert = require('assert-plus');
var async = require('async');
var clone = require('clone');
var common = require('./common');
var done = common.done;
var fmt = require('util').format;
var ifErr = common.ifErr;
var mod_client = require('./client');
var mod_err = require('../../lib/errors');
var mod_trunc = require('./trunc');
var mod_uuid = require('node-uuid');
var mod_log = require('./log');
var mod_vasync = require('vasync');



// --- Globals



var COLUMNS = mod_trunc.COLUMNS;
var LOG = mod_log.get().child({ component: 'rule' });
var RULES = {};

var ALREADY_EXISTS_ERR = {
    code: 'RuleExistsError',
    message: 'rule already exists',
    errors: [ mod_err.duplicateParam('uuid') ]
};


// --- Internal



function getGlobalRules(t, client, callback) {
    client.listRules({ global: true }, function (err, rules) {
        if (ifErr(t, err, 'listing global rules')) {
            return callback(err);
        }

        return callback(null, rules);
    });
}



// --- Exports



/**
 * Create a firewall rule
 */
function create(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');

    assert.object(opts.rule, 'opts.rule');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');

    var client = opts.client || mod_client.get('fwapi');

    var descFmt = ' (creating rule=%s)';
    var descLen = descFmt.length - 2;
    var desc = (opts.rule.rule.length + descLen > COLUMNS) ?
        fmt(descFmt, opts.rule.rule.slice(0, COLUMNS - descLen - 3) + '...') :
        fmt(descFmt, opts.rule.rule);

    LOG.debug({ rule: opts.rule }, 'creating rule');
    client.createRule(opts.rule, function (err, obj, req, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return done(err, null, t, callback);
        }

        if (ifErr(t, err, 'creating rule' + desc)) {
            return done(err, null, t, callback);
        }


        var updateID = res.headers['x-update-id'];
        t.ok(updateID, 'x-update-id: ' + updateID + desc);
        t.ok(obj.uuid, fmt('rule uuid: %s%s', obj.uuid, desc));

        if (opts.exp) {
            ['uuid', 'version'].forEach(function (p) {
                if (!opts.exp.hasOwnProperty(p)) {
                    opts.exp[p] = obj[p];
                }
            });

            t.deepEqual(obj, opts.exp, 'full result' + desc);
        }

        if (opts.partialExp) {
            for (var e in opts.partialExp) {
                t.equal(res[e], opts.partialExp[e], e + ' correct' + desc);
            }
        }

        RULES[obj.uuid] = clone(obj);
        LOG.debug({ rule: obj, updateID: updateID }, 'created rule');
        return done(null, obj, t, callback);
    });
}


/**
 * Create a rule, compare the output, then do the same for a get of
 * that nic.
 */
function createAndGet(t, opts, callback) {
    create(t, opts, function (err, res) {
        if (err) {
            return done(err, null, t, callback);
        }

        opts.uuid = res.uuid;
        return get(t, opts, callback);
    });
}


/**
 * Create and get an array of rules
 */
function createAndGetNrules(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.arrayOfObject(opts.rules, 'opts.rules');

    var created = [];

    mod_vasync.forEachParallel({
        inputs: opts.rules,
        func: function _addRule(rule, cb) {
            var createOpts = {
                exp: rule,
                rule: rule
            };

            createAndGet(t, createOpts, function _afterCreate(err, res) {
                if (res) {
                    created.push(res);
                }

                return cb(err, res);
            });
        }
    }, function (err) {
        return done(err, created, t, callback);
    });
}


/**
 * Delete a firewall rule
 */
function del(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');

    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.params, 'opts.params');

    var client = opts.client || mod_client.get('fwapi');
    var desc = fmt(' (del rule=%s)', opts.uuid);
    var params = opts.params || {};

    t.ok(opts.uuid, 'uuid ' + desc);
    LOG.debug({ opts: opts }, 'deleting rule');

    client.deleteRule(opts.uuid, params, function (err, obj, req, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error' + desc);
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code' + desc);
                t.deepEqual(err.body, opts.expErr, 'error body' + desc);
            }

            return done(err, null, t, callback);
        }

        if (ifErr(t, err, 'result' + desc)) {
            return done(err, null, t, callback);
        }

        var updateID = res.headers['x-update-id'];
        t.ok(updateID, 'x-update-id: ' + updateID + desc);

        t.equal(res.statusCode, 204, 'status code' + desc);
        delete RULES[opts.uuid];

        return done(null, obj, t, callback);
    });
}


/**
 * Deletes all rules created
 */
function delAllCreated(t, callback) {
    var toDel = Object.keys(RULES);
    if (toDel.length === 0) {
        done(null, toDel, t, callback);
        return;
    }

    LOG.debug({ toDel: toDel }, 'deleting all created rules');

    async.forEachSeries(toDel, function (uuid, cb) {
        delAndGet(t, {
            uuid: uuid
        }, function () {
            // Ignore the error and plow on
            return cb();
        });
    }, function (err) {
        return done(err, toDel, t, callback);
    });
}


/**
 * Delete a rule and GET it to confirm that it was deleted
 */
function delAndGet(t, opts, callback) {
    del(t, opts, function (err, res) {
        if (ifErr(t, err, 'Failed to delete rule')) {
            callback(err);
            return;
        }

        opts.expErr = {
            code: 'ResourceNotFound',
            message: 'Rule not found'
        };
        opts.expCode = 404;

        get(t, opts, callback);
    });
}


/**
 * Get a firewall rule
 */
function get(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');

    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.optionalObject(opts.rule, 'opts.rule');

    var client = opts.client || mod_client.get('fwapi');
    var params = opts.params || {};
    var desc = fmt(' (uuid=%s)', opts.uuid);

    client.getRule(opts.uuid, params, function (err, obj, req, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            if (obj && obj.rule) {
                t.deepEqual(obj, {}, 'rule found when error expected');
            }

            return done(err, null, t, callback);
        }

        if (ifErr(t, err, 'getting rule' + desc)) {
            return done(err, null, t, callback);
        }

        if (opts.exp) {
            ['uuid', 'version'].forEach(function (k) {
                if (!opts.exp.hasOwnProperty(k)) {
                    opts.exp[k] = obj[k];
                }
            });

            t.deepEqual(obj, opts.exp, 'full result' + desc);
        }

        if (opts.partialExp) {
            // Check to make sure that only the partial changes have changed
            var newExp = clone(RULES[opts.uuid]);
            newExp.version = obj.version;
            for (var e in opts.partialExp) {
                newExp[e] = opts.partialExp[e];
            }

            t.deepEqual(obj, newExp, 'updated result' + desc);
        }

        RULES[obj.uuid] = clone(obj);

        // If we passed in a rule, update it in place
        if (opts.rule) {
            var p;
            for (p in opts.rule) {
                delete opts.rule[p];
            }

            for (p in obj) {
                opts.rule[p] = obj[p];
            }
        }

        return done(null, obj, t, callback);
    });
}


/**
 * List firewall rules
 */
function listRules(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');

    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.params, 'opts.params');

    var client = opts.client || mod_client.get('fwapi');
    var params = opts.params || {};
    var descFmt = ' (params=%s)';
    var descLen = descFmt.length - 2;
    var desc = fmt(descFmt, mod_trunc.obj(params, COLUMNS - descLen));

    client.listRules(params, function (err, obj, req, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return done(err, null, t, callback);
        }

        if (ifErr(t, err, 'listing rules' + desc)) {
            return done(err, null, t, callback);
        }

        if (opts.exp) {
            t.deepEqual(obj.sort(common.uuidSort),
                clone(opts.exp).sort(common.uuidSort),
                'full result' + desc);
        }

        return done(null, obj, t, callback);
    });
}


/**
 * Get rules that affect a VM, and compare the list
 */
function resolve(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');

    assert.object(opts.params, 'opts.params');
    assert.object(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');

    var client = opts.client || mod_client.get('fwapi');
    var descFmt = ' (resolve: params=%s)';
    var descLen = descFmt.length - 2;
    var desc = opts.desc ||
        fmt(descFmt, mod_trunc.obj(opts.params, COLUMNS - descLen));

    getGlobalRules(t, client, function (gErr, globalRules) {
        if (gErr) {
            done(gErr, null, t, callback);
            return;
        }

        var postParams = {
            headers: { 'x-request-id': mod_uuid.v4() },
            path: '/resolve'
        };
        var reqID = postParams.headers['x-request-id'];
        t.ok(reqID, 'x-request-id=' + reqID);

        client.post(postParams, opts.params, function (err, obj, req, res) {
            if (opts.expErr) {
                t.ok(err, 'expected error');
                if (err) {
                    var code = opts.expCode || 422;
                    t.equal(err.statusCode, code, 'status code');
                    t.deepEqual(err.body, opts.expErr, 'error body');
                }

                return done(err, null, t, callback);
            }

            if (ifErr(t, err, 'resolving' + desc)) {
                return done(err, null, t, callback);
            }

            LOG.debug({ params: opts.params, result: obj }, 'resolve');

            if (opts.exp) {
                var newExp = clone(opts.exp);
                newExp.rules = newExp.rules.concat(globalRules).sort(
                    common.uuidSort);
                newExp.vms.sort();

                obj.rules.sort(common.uuidSort);

                t.deepEqual(obj, newExp, 'full result' + desc);
            }

            return done(null, obj, t, callback);
        });
    });
}


/**
 * Update a firewall rule
 */
function update(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');

    assert.object(opts.params, 'opts.params');
    assert.uuid(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.optionalObject(opts.rule, 'opts.rule');

    var client = opts.client || mod_client.get('fwapi');

    var descFmt = ' (params=%s, uuid=%s)';
    var descLen = descFmt.length - 4;
    var tparams = JSON.stringify(opts.params);
    var tuuid = opts.uuid;

    if (tparams.length + tuuid.length + descLen > COLUMNS) {
        tuuid = mod_trunc.uuid(tuuid);
        tparams = mod_trunc.obj(opts.params, COLUMNS - descLen - tuuid.length);
    }

    var desc = fmt(descFmt, tparams, tuuid);

    t.ok(opts.uuid, 'update' + desc);
    LOG.debug({ opts: opts }, 'updating rule');

    client.updateRule(opts.uuid, opts.params, function (err, obj, req, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return done(err, null, t, callback);
        }

        if (ifErr(t, err, 'updating rule' + desc)) {
            return done(err, null, t, callback);
        }

        var p;
        var updateID = res.headers['x-update-id'];
        t.ok(updateID, 'x-update-id: ' + updateID + desc);

        t.ok(obj.version !== RULES[opts.uuid].version, 'version changed');

        if (opts.exp) {
            opts.exp.version = obj.version;
            t.deepEqual(obj, opts.exp, 'full result' + desc);
        }

        if (opts.partialExp) {
            // Check to make sure that only the partial changes have changed
            var newExp = clone(RULES[opts.uuid]);
            newExp.version = obj.version;
            for (p in opts.partialExp) {
                newExp[p] = opts.partialExp[p];
            }

            t.deepEqual(obj, newExp, 'updated result' + desc);
        }

        RULES[obj.uuid] = clone(obj);

        // If we passed in a rule, update it in place
        if (opts.rule) {
            for (p in opts.rule) {
                delete opts.rule[p];
            }

            for (p in obj) {
                opts.rule[p] = obj[p];
            }
        }

        return done(null, obj, t, callback);
    });
}


/**
 * Update a rule, compare the output, then do the same for a get of
 * that nic.
 */
function updateAndGet(t, opts, callback) {
    update(t, opts, function (err, res) {
        if (err) {
            return done(err, null, t, callback);
        }

        return get(t, opts, callback);
    });
}


/**
 * Get rules that affect a VM, and compare the list
 */
function vmRules(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');

    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalArrayOfObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');

    var client = opts.client || mod_client.get('fwapi');
    var desc = fmt(' (get VM rules: uuid=%s)', opts.uuid);

    getGlobalRules(t, client, function (gErr, globalRules) {
        if (gErr) {
            done(gErr, null, t, callback);
            return;
        }

        client.getVMrules(opts.uuid, {}, function (err, obj, req, res) {
            if (opts.expErr) {
                t.ok(err, 'expected error');
                if (err) {
                    var code = opts.expCode || 422;
                    t.equal(err.statusCode, code, 'status code');
                    t.deepEqual(err.body, opts.expErr, 'error body');
                }

                return done(err, null, t, callback);
            }

            if (ifErr(t, err, 'creating rule' + desc)) {
                return done(err, null, t, callback);
            }

            if (opts.exp) {
                var newExp = clone(opts.exp);
                newExp = newExp.concat(globalRules);

                t.deepEqual(obj.sort(common.uuidSort),
                    newExp.sort(common.uuidSort), 'full result' + desc);
            }

            return done(null, obj, t, callback);
        });
    });
}



module.exports = {
    get alreadyExistsErr() {
        return clone(ALREADY_EXISTS_ERR);
    },
    get _rules() {
        return RULES;
    },
    create: create,
    createAndGet: createAndGet,
    createAndGetN: createAndGetNrules,
    del: del,
    delAllCreated: delAllCreated,
    delAndGet: delAndGet,
    get: get,
    list: listRules,
    update: update,
    updateAndGet: updateAndGet,
    resolve: resolve,
    vmRules: vmRules
};
