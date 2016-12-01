/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Restify handlers for vms affected by firewall rules
 */

var common = require('../common');
var restify = require('restify');
var util = require('util');



// --- Restify handlers



/**
 * GET /rules/:uuid/vms
 */
function getRuleVMs(req, res, next) {
    if (!req.params.owner_uuid) {
        return next(new restify.MissingParameterError(
            '"owner_uuid" parameter required'));
    }

    var filter = [];
    if (!req._rule.allVMs) {
        req._rule.vms.forEach(function (vm) {
            filter.push('(uuid=' + vm + ')');
        });

        req._rule.tags.forEach(function (t) {
            if (util.isArray(t)) {
                filter.push('(tags=*' + t[0] + '=' + t[1] + '*)');
            } else {
                filter.push('(tags=*' + t + '=*)');
            }
        });

        if (filter.length > 1) {
            filter = ['(|'].concat(filter).concat(')');
        }
    }

    // Always filter by owner_uuid
    filter.unshift('(&');
    filter.push('(owner_uuid=' + req.params.owner_uuid + '))');
    // Don't get data for VMs in a state where they have no IPs: destroyed,
    // failed, provisioning
    filter.unshift('(&');
    filter.push('(!(state=destroyed))');
    filter.push('(!(state=failed))');
    filter.push('(!(state=provisioning))');
    filter.push(')');

    var filterTxt = filter.join('');
    req.log.debug('listing VMs: %s', filterTxt);

    req._vmapi.listVms({ query: filterTxt }, {
        headers: {'request-id': req.getId()}
    }, function (err, vmList) {
        if (err) {
            return next(err);
        }

        res.send(200, vmList);
        return next();
    });
}



// --- Exports



/**
 * Registers endpoints with a restify server
 */
function register(server, before) {
    server.get({ path: '/rules/:uuid/vms', name: 'getRuleVMs' },
        before.concat(common.ruleBefore), getRuleVMs);
}



module.exports = {
    register: register
};
