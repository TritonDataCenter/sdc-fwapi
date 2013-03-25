/*
 * Copyright 2013 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for retrieving VM rules
 */

var common = require('./common');
var fw = require('../rule');
var restify = require('restify');



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
  var allVMs = false;
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
    rule[otherSide].tags.forEach(function (tag) {
      sideData.tags[tag] = 1;
    });
    rule[otherSide].vms.forEach(function (vm) {
      sideData.vms[vm] = 1;
    });
  }

  rules.forEach(function (rule) {
    var matched = false;

    log.debug({ params: params, from: rule.from, to: rule.to },
      'rule %s: finding side matches', rule.uuid);

    if (rule.allVMs) {
      matched = true;
      allVMs = true;
    }

    fw.DIRECTIONS.forEach(function (dir) {
      if (params.hasOwnProperty('tags')) {
        rule[dir].tags.forEach(function (tag) {
          if (params.tags.hasOwnProperty(tag)) {
            matched = true;
            log.debug('resolveTargets: matched rule=%s, dir=%s, tag=%s',
              rule.uuid, dir, tag);
            return addOtherSideData(rule, dir);
          }
        });
      }

      if (params.hasOwnProperty('vms')) {
        rule[dir].vms.forEach(function (vm) {
          if (params.vms.hasOwnProperty(vm)) {
            matched = true;
            log.debug('resolveTargets: matched rule=%s, dir=%s, vm=%s',
              rule.uuid, dir, vm);
            return addOtherSideData(rule, dir);
          }
        });
      }
      // XXX: subnet
    });

    if (!matched) {
      log.warn('rule %s: no matching tags or VMs found', rule.uuid);
    }
  });

  for (var type in sideData) {
    sideData[type] = Object.keys(sideData[type]).sort();
  }

  sideData.allVMs = allVMs;
  if (params.hasOwnProperty('owner_uuid')) {
    sideData.owner_uuid = params.owner_uuid;
  }

  return callback(null, sideData);
}



//--- Restify handlers



/*
 * Returns all data necessary to firewall the given VM:
 * - All rules that apply to that VM or its tags
 * - The VM's tags
 * - IPs for VM mentioned in the rules
 * - IPs for tags mentioned in the rules
 */
function resolve(req, res, next) {
  // ips, owner_uuid, tags, vms

  common.filterUFDSrules(req.params, req._app, req.log, function (err, rules) {
    if (err) {
      return next(err);
    }

    resolveTargets(rules, req.params, req.log, function (err, sideData) {
      if (err) {
        return next(err);
      }

      var payload = {
        rules: rules.map(function (r) {
          return r.serialize();
        })
      };

      for (var type in sideData) {
        payload[type] = sideData[type];
      }

      res.send(200, payload);
      return next();
    });
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
