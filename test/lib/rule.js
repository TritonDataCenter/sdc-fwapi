/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Helpers for manipulating FWAPI rules
 */

var assert = require('assert-plus');
var async = require('async');
var clone = require('clone');
var common = require('./common');
var done = common.done;
var fmt = require('util').format;
var ifErr = common.ifErr;
var mod_client = require('./client');
var mod_log = require('./log');



// --- Globals



var GLOBAL_RULES = [];
var GLOBAL_RULES_RETRIEVED = false;
var LOG = mod_log.child({ component: 'rule' });
var RULES = {};



// --- Internal



function getGlobalRules(t, client, callback) {
    if (GLOBAL_RULES_RETRIEVED) {
        return callback(null, clone(GLOBAL_RULES));
    }

    client.listRules({ global: true }, function (err, rules) {
        if (ifErr(t, err, 'listing global rules')) {
            return callback(err);
        }

        GLOBAL_RULES = clone(rules);
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
    var desc = fmt(' (rule=%s)', opts.rule.rule);

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
        delete RULES[obj.uuid];

        return done(null, obj, t, callback);
    });
}


/**
 * Deletes all rules created
 */
function delAllCreated(t, callback) {
    var toDel = Object.keys(RULES);
    if (toDel.length === 0) {
        return done(null, toDel, t, callback);
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
        opts.expErr = {
            code: 'ResourceNotFound',
            message: 'Rule not found'
        };
        opts.expCode = 404;

        return get(t, opts, callback);
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
    var desc = fmt(' (uuid=%s)', opts.uuid);

    client.getRule(opts.uuid, function (err, obj, req, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
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
function list(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');

    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.params, 'opts.params');

    var client = opts.client || mod_client.get('fwapi');
    var params = opts.params || {};
    var desc = fmt(' (params=%s)', params);

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
            t.deepEqual(obj, opts.exp, 'full result' + desc);
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
    var desc = opts.desc ||
        fmt(' (resolve: params=%s)', JSON.stringify(opts.params));

    getGlobalRules(t, client, function (gErr, globalRules) {
        if (gErr) {
            return done(gErr, null, t, callback);
        }

        client.post('/resolve', opts.params, function (err, obj, req, res) {
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
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.optionalObject(opts.rule, 'opts.rule');

    var client = opts.client || mod_client.get('fwapi');
    var desc = fmt(' (params=%s, uuid=%s)', JSON.stringify(opts.params),
        opts.uuid);

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
            return done(gErr, null, t, callback);
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
    get _rules() {
        return RULES;
    },
    create: create,
    createAndGet: createAndGet,
    del: del,
    delAllCreated: delAllCreated,
    delAndGet: delAndGet,
    get: get,
    list: list,
    update: update,
    updateAndGet: updateAndGet,
    resolve: resolve,
    vmRules: vmRules
};
