/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for firewall rules
 *
 */

var restify = require('restify');
var fw = require('./fwrule');
var FwRule = fw.FwRule;
var ufdsmodel = require('./ufds/ufdsmodel');
var validators = require('./fwrule-parser/validators');



//--- restify handlers


function ping(req, res, next) {
  if (req.params.error !== undefined) {
    var restCode = req.params.error || "InternalError";
    if (restCode.slice(-5) !== "Error") {
      restCode += "Error"
    }
    var err = new restify[restCode]("pong");
    res.sendError(err, err instanceof restify.ResourceNotFoundError);
  } else {
    var data = {
      ping: "pong",
      pid: process.pid
    };
    res.send(200, data);
  }
  return next();
}


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


function postRule(req, res, next) {
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


function putRule(req, res, next) {
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


function registerHandlers(server, before, after) {
  // XXX: should move this into app.js
  server.get('/ping', before, ping, after);
  // CRUD on rules
  server.get('/rules', before, listRules, after);
  server.post('/rules', before, postRule, after);
  server.put('/rules/:fwrule', before, putRule, after);
  server.get('/rules/:fwrule', before, getRule, after);
  server.del('/rules/:fwrule', before, deleteRule, after);
}


function populateConstructorData(req, data) {
  if (req._datacenter) {
    data.datacenter = req._datacenter;
  }
  data.user = req.params.user;
}


module.exports = {
  registerHandlers: registerHandlers,
  ping: ping,
  listRules: listRules,
  getRule: getRule,
  postRule: postRule,
  putRule: putRule,
  deleteRule: deleteRule
};
