/*
 * Copyright 2013 Joyent, Inc.  All rights reserved.
 *
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

    if (req._rule.owner_uuid) {
        if (filter.length !== 0) {
            filter.unshift('(&');
            filter.push('(owner_uuid=' + req._rule.owner_uuid + '))');
        } else {
            filter.push('(owner_uuid=' + req._rule.owner_uuid + ')');
        }
    }

    if (filter.length === 0 && !req._rule.allVMs) {
        res.send(202, []);
        return next();
    }

    var filterTxt = filter.join('');
    req.log.debug('listing VMs: %s', filterTxt);

    req._vmapi.listVms({ query: filterTxt }, function (err, vmList) {
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
