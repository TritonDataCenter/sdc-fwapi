/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for firewall rules
 */

var clone = require('clone');
var common = require('./common');
var filter = require('../ufds/filter');
var mod_err = require('../errors');
var restify = require('restify');
var Rule = require('../rule').Rule;
var ufdsmodel = require('../ufds/ufdsmodel');
var util = require('util');
var util_obj = require('../util/obj');



// --- Internal helpers



/**
 * Turns a fwrule error into an InvalidParamsError
 */
function createParamErr(err) {
    if (!err.hasOwnProperty('ase_errors') && !err.hasOwnProperty('field')) {
        return err;
    }

    var errs = err.hasOwnProperty('ase_errors') ? err.ase_errors : [ err ];
    return new mod_err.InvalidParamsError(mod_err.INVALID_MSG,
        errs.map(function (e) {
            return mod_err.invalidParam(e.field, e.message);
        }));
}



// --- Restify handlers



/**
 * GET /rules
 */
function listRules(req, res, next) {
    var ruleFilter;
    try {
        ruleFilter = filter.rules({ params: req.params, log: req.log });
    } catch (err) {
        return next(err);
    }

    return ufdsmodel.requestListFiltered(req, res, next, Rule, ruleFilter);
}


/**
 * GET /rules/:uuid
 */
function getRule(req, res, next) {
    return ufdsmodel.requestGet(req, res, next, Rule);
}


/**
 * POST /rules
 */
function createRule(req, res, next) {
    if (!req.params.rule) {
        return next(new restify.MissingParameterError(
            '"rule" parameter required'));
    }

    // Don't allow through objectclass
    delete req.params.objectclass;

    ufdsmodel.modelPost(req._app, Rule, req.params, req.log,
        function (err, rule) {
        if (err) {
            return next(createParamErr(err));
        }

        req._update.queue('fw.add_rule', rule.serialize(), function (err2) {
            if (err2) {
                return next(err2);
            }

            res.send(202, rule.serialize());
            return next();
        });
    });
}


/**
 * PUT /rules/:uuid
 */
function updateRule(req, res, next) {
    var newRule;
    var updateParams = clone(req._rule.serialize());

    for (var p in req.params) {
        updateParams[p] = req.params[p];
    }

    // Don't allow updating the rule's UUID
    updateParams.uuid = req._rule.uuid;
    // Don't allow through objectclass
    delete updateParams.objectclass;

    try {
        newRule = new Rule(updateParams);
    } catch (e) {
        return next(createParamErr(e));
    }

    newRule.incrementVersion();

    var change;
    var oldRaw = req._rule.raw();
    var newRaw = newRule.raw();

    for (var r in newRaw) {
        // If the old raw object has the item, we only need to do a 'replace'
        if (oldRaw.hasOwnProperty(r)) {
            delete oldRaw[r];
        }
    }

    if (req.log.debug()) {
        req.log.debug({ oldRaw: oldRaw, newRaw: newRaw },
            'Updating rule %s', req._rule.uuid);
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

    ufdsmodel.modify(req._app, Rule, req._dn, change, req.log,
        function (err, rule) {
        if (err) {
            return next(err);
        }

        req._update.queue('fw.update_rule', rule.serialize(), function (err2) {
            if (err2) {
                return next(err2);
            }

            res.send(202, rule.serialize());
            return next();
        });
    });
}


/**
 * DELETE /rules/:uuid
 */
function deleteRule(req, res, next) {
    var dn;
    try {
        dn = Rule.dnFromRequest(req);
    } catch (err) {
        return next(err);
    }

    ufdsmodel.modelDelete(req._app, Rule, dn, req.log, function (err) {
        if (err) {
            return next(err);
        }

        req._update.queue('fw.del_rule', req._rule.serialize(),
            function (err2) {
            if (err2) {
                return next(err2);
            }

            res.send(204);
            return next();
        });
    });
}



// --- Exports



/**
 * Registers endpoints with a restify server
 */
function register(server, before) {
    var matchingOwner = before.concat(common.ruleBefore);

    server.get({ path: '/rules', name: 'listRules' }, before, listRules);
    server.post({ path: '/rules', name: 'createRule' }, before, createRule);
    server.put({ path: '/rules/:uuid', name: 'updateRule' },
            matchingOwner, updateRule);
    server.get({ path: '/rules/:uuid', name: 'getRule' }, before, getRule);
    server.del({ path: '/rules/:uuid', name: 'deleteRule' },
            matchingOwner, deleteRule);
}



module.exports = {
    register: register
};
