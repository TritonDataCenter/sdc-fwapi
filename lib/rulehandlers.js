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


function registerHandlers(server, before, after) {
  // XXX: should move this into app.js
  server.get('/ping', before, ping, after);
  // CRUD on rules
  server.get('/firewalls/:user/rules', before, module.exports.listRules, after);
  server.post('/firewalls/:user/rules', before, module.exports.postRule, after);
  server.put('/firewalls/:user/rules/:fwuuid', before, module.exports.putRule, after);
  server.get('/firewalls/:user/rules/:fwuuid', before, module.exports.getRule, after);
  server.del('/firewalls/:user/rules/:fwuuid', before, module.exports.deleteRule, after);
}


function populateConstructorData(req, data) {
  if (req._datacenter) {
    data.datacenter = req._datacenter;
  }
}


module.exports = {
  registerHandlers: registerHandlers,
  ping: ping,
  // XXX: should be able to filter here, eg: -d enabled=true
  listRules: listRules,
  getRule: function getRule(req, res, next) {
    return ufdsmodel.requestGet(req, res, next, FwRule);
  },
  postRule: function postRule(req, res, next) {
    if (!req.params.rule) {
      res.sendError(new restify.MissingParameterError(
            "'rule' parameter required"));
      return next();
    }
    return ufdsmodel.requestPost(req, res, next, FwRule, populateConstructorData);
  },
  putRule: function putRule(req, res, next) {
    return ufdsmodel.requestPut(req, res, next, FwRule);
  },
  deleteRule: function deleteRule(req, res, next) {
    return ufdsmodel.requestDelete(req, res, next, FwRule);
  }
};
