/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for firewall rules
 *
 */

var restify = require('restify');
var fw = require('../fwrule');
var FwRule = fw.FwRule;
var ufdsmodel = require('../ufds/ufdsmodel');
var validators = require('../fwrule-parser/validators');



//--- restify handlers



function listRules(req, res, next) {
  if (!req.params.user) {
    res.sendError(new restify.MissingParameterError(
          "'user' parameter required"));
    return next();
  }

  function constructFilter() {
    var log = req._log;
    var filter = false;
    var filterContent = [ '(&' ];

    // TODO: these are actually unindexed in UFDS, meaning that searching on
    // these values is bad. Change how rules are stored so that this is
    // not the case!
    if (req.params.hasOwnProperty('enabled')) {
      var enabled = req.params.enabled;
      if ((enabled != "true") && (enabled != "false")) {
        res.sendError(new restify.InvalidArgumentError(
            "Invalid value for enabled: must be true or false"));
        return next();
      }
      filter = true;
      filterContent.push('(enabled=' + enabled + ')');
    }

    if (req.params.hasOwnProperty('port')) {
      var port = req.params.port;
      if (!validators.validatePort(port)) {
        res.sendError(new restify.InvalidArgumentError("port '"
            + port + "' is invalid"));
        return next();
      }
      filter = true;
      filterContent.push('(port=' + port + ')');
    }

    if (req.params.hasOwnProperty('protocol')) {
      var protocol = req.params.protocol;
      if (!validators.validateProtocol(protocol)) {
        res.sendError(new restify.InvalidArgumentError(
            "Invalid value for protocol: must be one of: " +
            fw.protocols.join(',')));
        return next();
      }
      filter = true;
      filterContent.push('(protocol=' + protocol + ')');
    }

    if (req.params.hasOwnProperty('action')) {
      var action = req.params.action;
      if (!validators.validateAction(action)) {
        res.sendError(new restify.InvalidArgumentError(
            "Invalid value for action: must be one of: " +
            fw.actions.join(',')));
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
    log.debug("listRules: filter=%s", filterTxt);
    return filterContent;
  }

  return ufdsmodel.requestListFiltered(req, res, next, FwRule, constructFilter);
}


function getRule(req, res, next) {
  if (!req.params.user) {
    res.sendError(new restify.MissingParameterError(
          "'user' parameter required"));
    return next();
  }
  return ufdsmodel.requestGet(req, res, next, FwRule);
}


function createRule(req, res, next) {
  if (!req.params.user) {
    res.sendError(new restify.MissingParameterError(
          "'user' parameter required"));
    return next();
  }

  if (!req.params.rule) {
    res.sendError(new restify.MissingParameterError(
          "'rule' parameter required"));
    return next();
  }

  return ufdsmodel.requestPost(req, res, next, FwRule, populateConstructorData);
}


function updateRule(req, res, next) {
  if (!req.params.user) {
    res.sendError(new restify.MissingParameterError(
          "'user' parameter required"));
    return next();
  }

  return ufdsmodel.requestPut(req, res, next, FwRule);
}


function deleteRule(req, res, next) {
  if (!req.params.user) {
    res.sendError(new restify.MissingParameterError(
          "'user' parameter required"));
    return next();
  }

  return ufdsmodel.requestDelete(req, res, next, FwRule);
}


function register(server, before) {
  server.get({ path: '/rules', name: 'listRules' }, before, listRules);
  server.post({ path: '/rules', name: 'createRule' }, before, createRule);
  server.put({ path: '/rules/:fwrule', name: 'updateRule' },
      before, updateRule);
  server.get({ path: '/rules/:fwrule', name: 'getRule' }, before, getRule);
  server.del({ path: '/rules/:fwrule', name: 'deleteRule' },
      before, deleteRule);
}


function populateConstructorData(req, data) {
  if (req._datacenter) {
    data.datacenter = req._datacenter;
  }
  data.user = req.params.user;
}


module.exports = {
  register: register
};
