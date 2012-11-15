/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for firewall rules
 */

var fw = require('../fwrule');
var FwRule = fw.FwRule;
var restify = require('restify');
var ufdsmodel = require('../ufds/ufdsmodel');
var util = require('util');
var validators = require('../fwrule-parser/validators');



// --- Internal helpers



function populateConstructorData(req, data) {
  if (req._datacenter) {
    data.datacenter = req._datacenter;
  }
  data.user = req.params.user;
}



//--- Restify handlers



/**
 * GET /rules
 */
function listRules(req, res, next) {
  // XXX: Do we actually want to limit this?
  if (!req.params.user) {
    return next(new restify.MissingParameterError(
          '"user" parameter required'));
  }

  function constructFilter() {
    var log = req.log;
    var filter = false;
    var filterContent = [ '(&' ];

    // TODO: these are actually unindexed in UFDS, meaning that searching on
    // these values is bad. Change how rules are stored so that this is
    // not the case!
    if (req.params.hasOwnProperty('enabled')) {
      var enabled = req.params.enabled;
      if ((enabled != 'true') && (enabled != 'false')) {
        return next(new restify.InvalidArgumentError(
            'Invalid value for enabled: must be true or false'));
      }
      filter = true;
      filterContent.push('(enabled=' + enabled + ')');
    }

    if (req.params.hasOwnProperty('port')) {
      var port = req.params.port;
      if (!validators.validatePort(port)) {
        return next(new restify.InvalidArgumentError(
          util.format('port "%s" is invalid', port)));
      }
      filter = true;
      filterContent.push('(port=' + port + ')');
    }

    if (req.params.hasOwnProperty('protocol')) {
      var protocol = req.params.protocol;
      if (!validators.validateProtocol(protocol)) {
        return next(new restify.InvalidArgumentError(
          util.format('Invalid value for protocol: must be one of: %s',
            fw.protocols.join(', '))));
      }
      filter = true;
      filterContent.push('(protocol=' + protocol + ')');
    }

    if (req.params.hasOwnProperty('action')) {
      var action = req.params.action;
      if (!validators.validateAction(action)) {
        return next(new restify.InvalidArgumentError(
            util.format('Invalid value for action: must be one of: %s',
            fw.actions.join(', '))));
        return next();
      }
      filter = true;
      filterContent.push('(action=' + action + ')');
    }

    fw.targetTypes.forEach(function(type) {
      if (req.params.hasOwnProperty(type)) {
        filter = true;
        filterContent.push('(|');
        filterContent.push('(from' + type + '=' + req.params[type] + ')');
        filterContent.push('(to' + type + '=' + req.params[type] + ')');
        filterContent.push(')');
      }
    });

    if (!filter) {
      return '';
    }
    filterContent.push(')');
    var filterTxt = filterContent.join('');
    log.debug('listRules: filter=%s', filterTxt);
    return filterContent;
  }

  return ufdsmodel.requestListFiltered(req, res, next, FwRule, constructFilter);
}


/**
 * GET /rules/:fwrule
 */
function getRule(req, res, next) {
  if (!req.params.user) {
    return next(new restify.MissingParameterError(
          '"user" parameter required'));
  }
  return ufdsmodel.requestGet(req, res, next, FwRule);
}


/**
 * POST /rules/:fwrule
 */
function createRule(req, res, next) {
  if (!req.params.user) {
    return next(new restify.MissingParameterError(
          '"user" parameter required'));
  }

  if (!req.params.rule) {
    return next(new restify.MissingParameterError(
          '"rule" parameter required'));
  }

  return ufdsmodel.requestPost(req, res, next, FwRule, populateConstructorData);
}


/**
 * PUT /rules/:fwrule
 */
function updateRule(req, res, next) {
  if (!req.params.user) {
    return next(new restify.MissingParameterError(
          '"user" parameter required'));
  }

  return ufdsmodel.requestPut(req, res, next, FwRule);
}


/**
 * DELETE /rules/:fwrule
 */
function deleteRule(req, res, next) {
  if (!req.params.user) {
    return next(new restify.MissingParameterError(
          '"user" parameter required'));
  }

  return ufdsmodel.requestDelete(req, res, next, FwRule);
}



// --- Exports



/**
 * Registers endpoints with a restify server
 */
function register(server, before) {
  server.get({ path: '/rules', name: 'listRules' }, before, listRules);
  server.post({ path: '/rules', name: 'createRule' }, before, createRule);
  server.put({ path: '/rules/:fwrule', name: 'updateRule' },
      before, updateRule);
  server.get({ path: '/rules/:fwrule', name: 'getRule' }, before, getRule);
  server.del({ path: '/rules/:fwrule', name: 'deleteRule' },
      before, deleteRule);
}



module.exports = {
  register: register
};
