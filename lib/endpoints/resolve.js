/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for retrieving machine rules
 */

var async = require('async');
var filter = require('../ufds/filter');
var fw = require('../fwrule');
var FwRule = fw.FwRule;
var pipeline = require('../pipeline').pipeline;
var restify = require('restify');
var ufdsmodel = require('../ufds/ufdsmodel');



//--- UFDS functions



/**
 * Gets rules for a machine from UFDS
 */
function filterUFDSrules(params, app, log, callback) {
  log.trace(params, 'filterUFDSrules: entry');
  var parentDn;
  var ruleFilter;
  var filterParams = { operation: 'OR' };

  if (params.hasOwnProperty('vms')) {
    filterParams.machine = params.vms;
  }

  if (params.hasOwnProperty('tags')) {
    filterParams.tag = Object.keys(params.tags);
  }

  try {
    ruleFilter = filter.rules(filterParams, log);
    parentDn = FwRule.parentDn(params.owner_uuid, params.datacenter);
  } catch (err) {
    return callback(err);
  }

  log.debug('filterUFDSrules: parentDn=%s, filter=%s', parentDn, ruleFilter);

  return ufdsmodel.modelListFiltered(app, FwRule, parentDn, ruleFilter,
    log, callback);
}



//--- Internal helpers



/**
 * Validate shared request params
 */
function validateReqParams(req, res, next) {
  // XXX: Do we actually want to limit this?
  if (!req.params.owner_uuid) {
    return next(new restify.MissingParameterError(
          '"owner_uuid" parameter required'));
  }

  return next();
}


/**
 * For targets specified by params, determine the targets on the other side
 * of the rules
 */
function resolveTargets(rules, params, log, callback) {
  var sideData = {
    tags: {},
    vms: {}
  };
  if (params.hasOwnProperty('vms')) {
    params.vms = params.vms.reduce(function (acc, vm) {
      acc[vm] = 1;
      return acc;
    }, {});
  }

  var addOtherSideData = function (rule, d) {
    var otherSide = d == 'from' ? 'to' : 'from';
    rule.tags()[otherSide].forEach(function (tag) {
      sideData.tags[tag] = 1;
    });
    rule.machines()[otherSide].forEach(function (machine) {
      sideData.vms[machine] = 1;
    });
  }

  rules.forEach(function (rule) {
    var matched = false;
    var ruleTags = rule.tags();
    var ruleMachines = rule.machines();

    log.debug({ params: params, tags: ruleTags, machines: ruleMachines },
      'rule %s: finding side matches', rule.id);

    fw.DIRECTIONS.forEach(function (dir) {
      if (params.hasOwnProperty('tags')) {
        ruleTags[dir].forEach(function (tag) {
          if (params.tags.hasOwnProperty(tag)) {
            matched = true;
            log.debug('resolveTargets: matched rule=%s, dir=%s, tag=%s',
              rule.id, dir, tag);
            return addOtherSideData(rule, dir);
          }
        });
      }

      if (params.hasOwnProperty('vms')) {
        ruleMachines[dir].forEach(function (machine) {
          if (params.vms.hasOwnProperty(machine)) {
            matched = true;
            log.debug('resolveTargets: matched rule=%s, dir=%s, machine=%s',
              rule.id, dir, machine);
            return addOtherSideData(rule, dir);
          }
        });
      }
      // XXX: subnet
    });

    if (!matched) {
      log.warn('rule %s: no matching rules found', rule.id);
    }
  });

  for (var type in sideData) {
    sideData[type] = Object.keys(sideData[type]).sort();
  }
  return callback(null, sideData);
}



//--- Restify handlers



/*
 * Returns all data necessary to firewall the given machine:
 * - All rules that apply to that machine or its tags
 * - The machine's tags
 * - IPs for machines mentioned in the rules
 * - IPs for tags mentioned in the rules
 */
function resolve(req, res, next) {
  // ips, owner_uuid, tags, vms

  req.params.datacenter = req._datacenter;
  pipeline({
    funcs: [
    // XXX: get datacenter-wide rules
      function ufdsRules(_, cb) {
        filterUFDSrules(req.params, req._app, req.log, cb);
      },
      function sideData(state, cb) {
        resolveTargets(state.ufdsRules, req.params, req.log, cb);
      },
    ]}, function (err, results) {
      if (err) {
        return next(err);
      }

      var payload = {
        rules: results.state.ufdsRules.map(function (r) {
          return r.serialize();
        })
      };
      for (var type in results.state.sideData) {
        payload[type] = results.state.sideData[type];
      }

      res.send(200, payload);
      return next();
    });
}



// --- Exports



/**
 * Registers endpoints with a restify server
 */
function register(server, before) {
  var allBefore = before.concat(validateReqParams);
  server.post({ path: '/resolve', name: 'resolve' },
      allBefore, resolve);
}



module.exports = {
  register: register
};
