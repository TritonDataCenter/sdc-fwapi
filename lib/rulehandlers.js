/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for firewall rules
 *
 */

var restify = require('restify');
var FwRule = require('./fwrule').FwRule;
var ufdsmodel = require('./ufds/ufdsmodel');


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
  listRules: function listRules(req, res, next) {
    return ufdsmodel.requestList(req, res, next, FwRule);
  },
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
