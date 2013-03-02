/*
 * Copyright 2013 Joyent, Inc.  All rights reserved.
 *
 * Shared code between restify endpoints
 */

var filter = require('../ufds/filter');
var fw = require('../rule');
var mod_err = require('../errors');
var ufdsmodel = require('../ufds/ufdsmodel');



// --- Exports



/**
 * Gets rules for a VM from UFDS
 */
function filterUFDSrules(params, app, log, callback) {
  //log.trace(params, 'filterUFDSrules: entry');
  log.debug(params, 'filterUFDSrules: entry');
  var parentDn = fw.parentDn();
  var ruleFilter;
  var filterParams = { operation: 'OR' };

  if (params.hasOwnProperty('vms')) {
    filterParams.vm = params.vms;
  }

  if (params.hasOwnProperty('tags')) {
    filterParams.tag = Object.keys(params.tags);
  }

  try {
    ruleFilter = filter.rules(filterParams, log);
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

    if (req.params.hasOwnProperty('owner_uuid')
      && rule.hasOwnProperty('owner_uuid')
      && req.params.owner_uuid !== rule.owner_uuid) {
      return next(new mod_err.PermissionDeniedError('owner does not match',
        [ mod_err.invalidParam('owner_uuid', 'owner_uuid does not match') ]));
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
