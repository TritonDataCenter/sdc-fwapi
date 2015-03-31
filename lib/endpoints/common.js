/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Shared code between restify endpoints
 */

var fw = require('../rule');
var mod_err = require('../errors');
var mod_filter = require('../ufds/filter');
var ufdsmodel = require('../ufds/model');



// --- Exports



/**
 * Gets a filtered list of rules from UFDS that apply to VMs with the
 * attributes listed in parameters
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
function filterUFDSrules(params, app, log, callback) {
    log.debug(params, 'filterUFDSrules: entry');
    var filter = {
        log: log,
        operation: 'OR',
        ownerlessRules: true,
        params: {
            wildcard: ['vmall']
        }
    };
    var parentDn = fw.parentDn();
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

    try {
        ruleFilter = mod_filter.rules(filter);
    } catch (err) {
        return callback(err);
    }

    log.debug('filterUFDSrules: parentDn=%s, filter=%s', parentDn, ruleFilter);

    return ufdsmodel.modelListFiltered(app, fw.Rule, parentDn, ruleFilter,
        log, callback);
}


/**
 * Restify 'before' handler:
 * * gets an existing rule from UFDS and stores it in req._rule
 * * stores the rule's dn in req._dn
 * * makes sure the user is allowed to modify the rule by checking owner_uuid
 */
function ruleBefore(req, res, next) {
    var dn;

    try {
        dn = fw.Rule.dnFromRequest(req);
    } catch (err) {
        req.log.error(err, 'Error creating <Rule> dn');
        return next(err);
    }

    ufdsmodel.modelGet(req._app, fw.Rule, dn, req.log, function (err, rule) {
        if (err) {
            return next(err);
        }

        if (req.params.hasOwnProperty('owner_uuid') &&
            rule.hasOwnProperty('owner_uuid') &&
            req.params.owner_uuid !== rule.owner_uuid) {
            return next(new mod_err.PermissionDeniedError(
                'owner does not match', [
                mod_err.invalidParam('owner_uuid',
                    'owner_uuid does not match') ]));
        }

        req._dn = dn;
        req._rule = rule;
        return next();
    });
}


module.exports = {
    filterUFDSrules: filterUFDSrules,
    ruleBefore: ruleBefore
};
