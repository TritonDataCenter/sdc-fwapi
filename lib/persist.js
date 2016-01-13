/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

var async = require('async');
var fw = require('./rule');
var mod_err = require('./errors');
var mod_filter = require('./ufds/filter');
var restify = require('restify');
var ufdsmodel = require('./ufds/model');
var util_obj = require('./util/obj');
var util_validate = require('./util/validate');

var Rule = fw.Rule;

/*
 * Returns a nicely formatted error, rather than the generic UFDS or Moray not
 * found error.
 */
function notFoundErr(Model, uuid) {
    var err = new restify.ResourceNotFoundError('%s not found', Model.name);
    // Add UUID so that it will get logged
    err.uuid = uuid;

    return err;
}

function mkRule(data, app, cb) {
    try {
        return cb(null, new Rule(data, app));
    } catch (e) {
        return cb(e);
    }
}

/*
 * Wrap a callback with code to check for rule lookup errors,
 * and replace them with a Restify error.
 */
function checkNotFound(app, uuid, callback) {
    if (app.config.fwrule_version > 2) {
        return function (err, val) {
            if (err) {
                if (err.name === 'ObjectNotFoundError') {
                    return callback(notFoundErr(Rule, uuid));
                }

                return callback(err);
            }

            return callback(null, val);
        };
    } else {
        return function (err, val) {
            if (err) {
                if (err.body && err.body.code === 'ResourceNotFound') {
                    return callback(notFoundErr(Rule, uuid));
                }

                return callback(err);
            }

            return callback(null, val);
        };
    }
}

function createRule(app, log, params, callback) {
    var raw;

    // Don't allow through objectclass
    delete params.objectclass;

    if (app.config.fwrule_version > 2) {
        try {
            raw = new Rule(params, app).raw();
            app.moray.putObject(fw.BUCKET.name, raw.uuid, raw,
                function (err) { callback(err, new Rule(raw, app)); });
        } catch (e) {
            callback(e);
        }
    } else {
        ufdsmodel.modelPost(app, Rule, params, log, callback);
    }
}

function updateRuleUFDS(app, log, newRule, oldRule, callback) {
    var change;
    var oldRaw = oldRule.raw();
    var newRaw = newRule.raw();
    var dn = Rule.dn(newRule.uuid);

    for (var r in newRaw) {
        // If the old raw object has the item, we only need to do a 'replace'
        if (oldRaw.hasOwnProperty(r)) {
            delete oldRaw[r];
        }
    }

    if (log.debug()) {
        log.debug({ oldRaw: oldRaw, newRaw: newRaw },
            'Updating rule %s', oldRule.uuid);
    }

    if (util_obj.isEmpty(oldRaw)) {
        change = {
            operation: 'replace',
            modification: newRaw
        };
    } else {
        change = [
            {
                operation: 'delete',
                modification: oldRaw
            },
            {
                operation: 'replace',
                modification: newRaw
            }
        ];
    }

    ufdsmodel.modify(app, Rule, dn, change, log, callback);
}

function updateRule(app, log, newRule, oldRule, callback) {
    callback = checkNotFound(app, newRule.uuid, callback);
    if (app.config.fwrule_version > 2) {
        app.moray.putObject(fw.BUCKET.name, newRule.uuid, newRule.raw(),
            function (err) { callback(err, newRule); });
    } else {
        return updateRuleUFDS(app, log, newRule, oldRule, callback);
    }
}

function deleteRule(app, log, uuid, callback) {
    if (!util_validate.uuid(uuid)) {
        return callback(new mod_err.InvalidParamsError(mod_err.INVALID_MSG,
            [ mod_err.invalidParam('uuid', 'Invalid UUID') ]));
    }

    callback = checkNotFound(app, uuid, callback);

    if (app.config.fwrule_version > 2) {
        app.moray.delObject(fw.BUCKET.name, uuid, callback);
    } else {
        ufdsmodel.modelDelete(app, Rule, Rule.dn(uuid), log, callback);
    }
}

function getRule(app, log, uuid, callback) {
    if (!util_validate.uuid(uuid)) {
        return callback(new mod_err.InvalidParamsError(mod_err.INVALID_MSG,
            [ mod_err.invalidParam('uuid', 'Invalid UUID') ]));
    }

    callback = checkNotFound(app, uuid, callback);

    if (app.config.fwrule_version > 2) {
        return app.moray.getObject(fw.BUCKET.name, uuid, function (err, obj) {
            if (err) {
                log.error(err, 'Error getting rule from Moray');
                return callback(err);
            }

            mkRule(obj.value, app, callback);
        });
    } else {
        return ufdsmodel.modelGet(app, Rule, Rule.dn(uuid), log, callback);
    }
}

/**
 * Gets a filtered list of rules that apply to VMs with the
 * attributes listed in parameters
 *
 * @param params {Object}: filtering parameters:
 *   These parameters are ORed:
 *     - vms {Array}: VM UUIDs
 *     - tags {Object}: tags
 *   and then ANDed with:
 *     - owner_uuid {UUID}
 *   In addition, rules matching the following are found:
 *     - rules that apply to all VMs
 *     - rules with no owner UUID that match the ORed parameters above
 * @param app {App}
 * @param app {Bunyan Logger}
 * @param callback {Function}: `function (err, res)`, where res is an
 *   array of rule objects from UFDS that satisfied the above criteria
 */
function vmRules(app, log, params, callback) {
    log.debug(params, 'vmRules: entry');
    var filter = {
        log: log,
        operation: 'OR',
        ownerlessRules: true,
        params: {
            wildcard: ['vmall']
        }
    };
    var ruleFilter;

    if (params.hasOwnProperty('vms')) {
        filter.params.vm = params.vms;
    }

    if (params.hasOwnProperty('tags')) {
        filter.params.tag = params.tags;
    }

    if (params.hasOwnProperty('owner_uuid')) {
        filter.params.owner_uuid = params.owner_uuid;
    }

    if (app.config.fwrule_version > 2) {
        try {
            ruleFilter = mod_filter.morayRules(filter);
        } catch (err) {
            return callback(err);
        }

        log.debug('vmRules (Moray): filter=%s', ruleFilter);

        var rules = [];
        var req = app.moray.findObjects(fw.BUCKET.name, ruleFilter, {});
        req.once('error', callback);
        req.on('record', function (obj) {
            rules.push(obj.value);
        });
        req.on('end', function () {
            async.map(rules, function (rule, cb) {
                mkRule(rule, app, cb);
            }, callback);
        });
    } else {
        try {
            ruleFilter = mod_filter.ufdsRules(filter);
        } catch (err) {
            return callback(err);
        }

        var parentDn = Rule.parentDn();
        log.debug('vmRules (UFDS): parentDn=%s, filter=%s',
            parentDn, ruleFilter);
        return ufdsmodel.modelListFiltered(app, fw.Rule, parentDn, ruleFilter,
            log, callback);
    }
}

function findRules(app, log, params, callback) {
    var filter = {
        log: log,
        params: params
    };
    var ruleFilter;

    if (app.config.fwrule_version > 2) {
        try {
            ruleFilter = mod_filter.morayRules(filter);
        } catch (err) {
            return callback(err);
        }

        log.debug('findRules (Moray): filter=%s', ruleFilter);

        var rules = [];
        var req = app.moray.findObjects(fw.BUCKET.name, ruleFilter, {});
        req.once('error', callback);
        req.on('record', function (obj) {
            rules.push(obj.value);
        });
        req.on('end', function () {
            async.map(rules, function (rule, cb) {
                mkRule(rule, app, cb);
            }, callback);
        });
    } else {
        try {
            ruleFilter = mod_filter.ufdsRules(filter);
        } catch (err) {
            return callback(err);
        }

        var parentDn = Rule.parentDn();
        log.debug('vmRules (UFDS): parentDn=%s, filter=%s',
            parentDn, ruleFilter);
        return ufdsmodel.modelListFiltered(app, fw.Rule, parentDn, ruleFilter,
            log, callback);
    }
}

module.exports = {
    vmRules: vmRules,
    findRules: findRules,
    getRule: getRule,
    deleteRule: deleteRule,
    updateRule: updateRule,
    createRule: createRule
};
