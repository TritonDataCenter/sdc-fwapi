/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Restify handlers for firewall rules
 */

'use strict';

var clone = require('clone');
var common = require('../common');
var mod_err = require('../../errors');
var mod_persist = require('../../persist');
var mod_const = require('../../util/constants');
var restify = require('restify');
var Rule = require('../../rule').Rule;
var validate = require('restify-warden');


var hasKey = require('jsprim').hasKey;


// --- Globals

var LIST_SCHEMA = {
    strict: true,
    optional: {
        fields: validate.fieldsArray(mod_const.PARSED_FIELDS),
        ip: validate.IParray,
        owner_uuid: validate.UUIDarray,
        protocol: validate.string,
        subnet: validate.subnetArray,
        vm: validate.UUIDarray,
        enabled: validate.boolean,
        action: validateAction,
        global: validate.boolean,
        tag: validateTag,
        wildcard: validateArrayOfStrings,
        log: validate.boolean
    }
};

var DELETE_SCHEMA = {
    strict: true,
    required: {
        uuid: validate.UUID
    },
    optional: {
        owner_uuid: validate.UUID
    }
};


// --- Internal

function validateAction(_, name, act, callback) {
    if (typeof (act) !== 'string' || (act !== 'block' && act !== 'allow')) {
        callback(mod_err.invalidParam(name,
            'action must be "block" or "allow"'));
        return;
    }
    callback(null, act);
}

function validateArrayOfStrings(_, name, arr, callback) {
    if (typeof (arr) !== 'string') {
        var i;
        for (i = 0; i < arr.length; i++) {
            var s = arr[i];
            if (typeof (s) !== 'string') {
                callback(mod_err.invalidParam(name,
                    'must be array of strings'));
                return;
            }
        }
    }
    callback(null, s);
}

function validateTag(_, name, tag, callback) {
    if (Array.isArray(tag) || typeof (tag) === 'string' ||
        typeof (tag) === 'object') {

        callback(null, tag);
    } else {
        callback(mod_err.invalidParam(name,
            'must be string, object, or array'));
    }
}



/**
 * Turns a fwrule error into an InvalidParamsError
 */
function createParamErr(err) {
    if (!hasKey(err, 'ase_errors') && !hasKey(err, 'field')) {
        return err;
    }

    var errs = hasKey(err, 'ase_errors') ? err.ase_errors : [ err ];
    return new mod_err.InvalidParamsError(mod_err.INVALID_MSG,
        errs.map(function (e) {
            return mod_err.invalidParam(e.field, e.message);
        }));
}


/**
 * Restify 'before' handler: if the rule is global and we have owner_uuid set
 * in the request params, return Permission Denied. Requires
 * common.ruleBefore() to be run before to populate req._rule.
 */
function disallowOwnerForGlobal(req, res, next) {
    var rule = req._rule;
    if (!hasKey(rule, 'global') || !rule.global) {
        next();
        return;
    }

    if (!hasKey(req.params, 'owner_uuid')) {
        next();
        return;
    }

    next(new mod_err.PermissionDeniedError('owner does not match',
        [ mod_err.invalidParam('owner_uuid', 'owner_uuid does not match') ]));
}



// --- Restify handlers



/**
 * GET /rules
 */
function listRules(req, res, next) {
    validate.params(LIST_SCHEMA, null, req.params,
        function cb(valErr, validated) {
        var serializeOpts;
        if (valErr) {
            next(valErr);
            return;
        }
        if (validated.fields) {
            serializeOpts = { fields: validated.fields };
        }
        mod_persist.findRules(req._app, req.log, req.params,
            function (err, rules) {
            if (err) {
                next(err);
                return;
            }

            res.send(200, rules.map(function (rule) {
                return rule.serialize(serializeOpts);
            }));
            next();
            return;
        });
    });
}


/**
 * GET /rules/:uuid
 */
function getRule(req, res, next) {
    res.send(200, req._rule.serialize());
    return next();
}


/**
 * POST /rules
 */
function createRule(req, res, next) {
    if (!req.params.rule) {
        next(new restify.MissingParameterError(
            '"rule" parameter required'));
        return;
    }

    mod_persist.createRule(req._app, req.log, req.params,
        function (err, rule) {
        if (err) {
            next(createParamErr(err));
            return;
        }

        req._update.queue('fw.add_rule', rule.serialize(),
            function (err2, update) {
            if (err2) {
                return next(err2);
            }

            res.header('x-update-id', update.uuid);
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
        newRule = new Rule(updateParams, req._app);
    } catch (e) {
        next(createParamErr(e));
        return;
    }

    newRule.incrementVersion();

    mod_persist.updateRule(req._app, req.log, newRule, req._rule,
        function (err, rule) {
        if (err) {
            next(err);
            return;
        }

        req._update.queue('fw.update_rule', rule.serialize(),
            function (err2, update) {
            if (err2) {
                return next(err2);
            }

            res.header('x-update-id', update.uuid);
            res.send(202, rule.serialize());
            return next();
        });
    });
}


/**
 * DELETE /rules/:uuid
 */
function deleteRule(req, res, next) {
    validate.params(DELETE_SCHEMA, null, req.params,
        function (valErr, _validated) {
        if (valErr) {
            next(valErr);
            return;
        }

        var uuid = req.params.uuid;
        mod_persist.deleteRule(req._app, req.log, uuid, function (err) {
            if (err) {
                next(err);
                return;
            }

            req._update.queue('fw.del_rule', req._rule.serialize(),

                function (err2, update) {

                if (err2) {
                    next(err2);
                    return;
                }

                res.header('x-update-id', update.uuid);
                res.send(204);
                next();
                return;
            });
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
            matchingOwner.concat(disallowOwnerForGlobal), updateRule);
    server.get({ path: '/rules/:uuid', name: 'getRule' },
            matchingOwner.concat(disallowOwnerForGlobal), getRule);
    server.del({ path: '/rules/:uuid', name: 'deleteRule' },
            matchingOwner.concat(disallowOwnerForGlobal), deleteRule);
}



module.exports = {
    register: register
};
