/*
 * Copyright (c) 2011 Joyent, Inc.  All rights reserved.
 *
 * The firewall API master app.
 */

var restify = require('restify');
var ldap = require('ldapjs');
// XXX: look at Pedro's mapi v2 for how to do this better:
var log = restify.log;
var constants = require('./constants');
var ruleHandlers = require('./rulehandlers');
var machineHandlers = require('./machinehandlers');
var MAPI = require('node-sdc-clients').MAPI;

/**
 * Create the app.
 *
 * @param config {Object} The config object.
 * @param callback {Function} `function (err, app) {...}`.
 */
function createApp(config, callback) {
  if (!config) {
    return callback(new TypeError('config is required'));
  }

  if (config.logLevel) {
    log.info("Log level: %s", config.logLevel);
    log.level(config.logLevel);
  }

  if (!config.ufds) {
    return callback(new TypeError('config.ufds is required'));
  }
  if (!config.mapi) {
    return callback(new TypeError('config.mapi is required'));
  }

  var mapi = new MAPI({
    username: config.mapi.username,
    password: config.mapi.password,
    uri: config.mapi.uri,
    logLevel: config.logLevel
  });

  var ufds = ldap.createClient({
    url: config.ufds.url
  });

  ufds.bind(config.ufds.rootDn, config.ufds.password, function(err) {
    if (err) {
      return callback(err);
    }
    try {
      var app = new App(config, ufds, mapi);
    } catch(err) {
      return callback(err);
    }
    return callback(null, app);
  });
}

function App(config, ufds, mapi) {
  var self = this;

  if (!config) throw TypeError('config is required');
  if (!config.port) throw TypeError('config.port is required');
  if (!config.dataCenterName) throw TypeError('config.dataCenterName is required');
  if (!ufds) throw TypeError('ufds is required');
  if (!mapi) throw TypeError('mapi is required');
  this.config = config;
  this.ufds = ufds;
  this.mapi = mapi;

  // Runs before every request
  function setup(req, res, next) {
    req._log = log;
    req._ufds = ufds;
    req._mapi = mapi;
    req._app = self;
    req._datacenter = config.dataCenterName;
    return next();
  }

  var before = [setup];
  var after = [restify.log.w3c];

  var server = this.server = restify.createServer({
    apiVersion: constants.apiVersion,
    serverName: constants.serverName
  });

  ruleHandlers.registerHandlers(server, before, after);
  machineHandlers.registerHandlers(server, before, after);
}

App.prototype.listen = function(callback) {
  this.server.listen(this.config.port, '0.0.0.0', callback);
};

App.prototype.cacheGet = function(scope, key) {
  // XXX: actually add caching here
  return;
};

App.prototype.cacheSet = function(scope, key, value) {
  // XXX: actually add caching here
  return;
}

App.prototype.cacheInvalidatePut = function(modelName, item) {
  // XXX: actually add caching here
  return;
}

App.prototype.cacheInvalidateDelete = function(modelName, item) {
  // XXX: actually add caching here
  return;
}

/**
 * Close this app.
 *
 * @param {Function} callback called when closed. Takes no arguments.
 */
App.prototype.close = function(callback) {
  var self = this;
  this.server.on('close', function() {
    self.ufds.unbind(function() {
      return callback();
    });
  });
  this.server.close();
};


module.exports = {
  App: App,
  createApp: createApp
};

