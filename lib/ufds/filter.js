/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Helpers for filtering UFDS data
 */

var fw = require('../fwrule');
var restify = require('restify');
var validators = require('../fwrule-parser/validators');


// --- Internal helpers



/**
 * Turn a value into an array, unless it is one already.
 */
function arrayify(obj) {
  if (typeof obj === 'object') {
    return obj;
  }

  return obj.split(',');
}



// --- Exports



/**
 * Constructs an LDAP filter for firewall rules
 *
 * @param params {Object}: filter parameters
 * - action {String}
 * - enabled {Boolean}
 * - port {Integer}
 * - protocol {String}
 * - ip {String or Array}
 * - machine {String or Array}
 * - subnet {String or Array}
 * - tag {String or Array}
 * @param log {Object}: bunyan logger
 */
function ruleFilter(params, log) {
  var filter = [ '(&' ];

  if (params.hasOwnProperty('operation')) {
    if (params.operation == 'OR') {
      filter = [ '(|' ];
    } else {
      throw new restify.InvalidArgumentError(
          'Invalid operation "%s" for filter', params.operation);
    }
  }

  // TODO: these are actually unindexed in UFDS, meaning that searching on
  // these values is bad. Change how rules are stored so that this is
  // not the case!
  if (params.hasOwnProperty('enabled')) {
    if ((params.enabled != 'true') && (params.enabled != 'false')) {
      throw new restify.InvalidArgumentError(
          'Invalid value for enabled: must be true or false');
    }
    filter.push(util.format('(enabled=%s)', params.enabled));
  }

  if (params.hasOwnProperty('port')) {
    if (!validators.validatePort(params.port)) {
      throw new restify.InvalidArgumentError(
        util.format('port "%s" is invalid', params.port));
    }
    filter.push(util.format('(port=%s)', params.port));
  }

  if (params.hasOwnProperty('protocol')) {
    if (!validators.validateProtocol(params.protocol)) {
      throw new restify.InvalidArgumentError(
        util.format('Invalid value for protocol: must be one of: %s',
          fw.protocols.join(', ')));
    }
    filter.push(util.format('(protocol=%s)', params.protocol));
  }

  if (params.hasOwnProperty('action')) {
    if (!validators.validateAction(params.action)) {
      throw new restify.InvalidArgumentError(
          util.format('Invalid value for action: must be one of: %s',
          fw.actions.join(', ')));
    }
    filter.push(util.format('(action=%s)', params.action));
  }

  fw.targetTypes.forEach(function (type) {
    if (params.hasOwnProperty(type)) {
      var types = arrayify(params[type]);
      filter.push('(|');
      types.forEach(function (t) {
        filter.push(util.format('(from%s=%s)', type, t));
        filter.push(util.format('(to%s=%s)', type, t));
      });
      filter.push(')');
    }
  });

  if (filter.length == 1) {
    return '';
  }

  filter.push(')');
  var filterTxt = filter.join('');

  log.debug('listRules: filter=%s', filterTxt);
  return filterTxt;
}



module.exports = {
  rules: ruleFilter
};
