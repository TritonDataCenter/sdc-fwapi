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
  req._rule.vms.forEach(function (vm) {
    filter.push('(uuid=' + vm + ')');
  });
  req._rule.tags.forEach(function (t) {
    filter.push('(tags=*' + t + '=*)');
  });
  // XXX: 'all'

  if (filter.length > 1) {
    filter = ['(|'].concat(filter).concat(')');
  }

  if (filter.length !== 0 && req.params.hasOwnProperty('owner_uuid')) {
    filter = ['(&'].concat(filter).concat(
      '(owner_uuid=' + req.params.owner_uuid + ')', ')');
  }

  if (filter.length === 0) {
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
