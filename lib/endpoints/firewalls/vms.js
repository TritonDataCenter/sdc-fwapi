/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Restify handlers for listing rules applied to vms
 */

var mod_err = require('../../errors');
var mod_persist = require('../../persist');
var restify = require('restify');
var util = require('util');
var validators = require('fwrule/lib/validators');



// --- Internal helpers



/**
 * restify 'before' handler for validating request parameters
 * for getVMrules below
 */
function validateParams(req, res, next) {
    if (!validators.validateUUID(req.params.uuid)) {
        return next(new mod_err.InvalidParamsError(mod_err.INVALID_MSG,
            [ mod_err.invalidParam('uuid', 'Invalid UUID') ]));
    }

    if (req.params.hasOwnProperty('owner_uuid') &&
            !validators.validateUUID(req.params.owner_uuid)) {
        return next(new mod_err.InvalidParamsError(mod_err.INVALID_MSG,
            [ mod_err.invalidParam('owner_uuid', 'Invalid UUID') ]));
    }

    return next();
}



// --- Restify handlers



/**
 * GET /firewalls/vms/:uuid
 */
function getVMrules(req, res, next) {
    req._vmapi.getVm(req.params, {
        headers: {'request-id': req.getId()}
    }, function (err, vm) {
        if (err) {
            return next(err);
        }
        var filter = {
            owner_uuid: vm.owner_uuid,
            tags: vm.tags,
            vms: [ vm.uuid ]
        };

        req.log.debug(filter, 'filtering UFDS rules');
        mod_persist.vmRules(req._app, req.log, filter,
            function (err2, rules) {
            if (err2) {
                return next(err2);
            }

            res.send(200, rules.map(function (r) {
                return r.serialize();
            }));

            return next();
        });
    });
}



// --- Exports



/**
 * Registers endpoints with a restify server
 */
function register(server, before) {
    server.get({ path: '/firewalls/vms/:uuid', name: 'getVMrules' },
        before.concat(validateParams), getVMrules);
}



module.exports = {
    register: register
};
