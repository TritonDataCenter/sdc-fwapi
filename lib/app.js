/*
 * Copyright (c) 2011 Joyent, Inc.  All rights reserved.
 *
 * The firewall API master app.
 */

var ldap = require('ldapjs');
var restify = require('restify');
// XXX: look at Pedro's mapi v2 for how to do this better:

var constants = require('./constants');
var endpoints = require('./endpoints');
var MAPI = require('node-sdc-clients').MAPI;

/**
 * Create the app.
 *
 * @param config {Object} The config object.
 * @param callback {Function} `function (err, app) {...}`.
 */
function createApp(opts, callback) {
  var config = opts.config;
  var log = opts.log;

  if (!config) {
    return callback(new TypeError('config is required'));
  }
  if (!config.ufds) {
    return callback(new TypeError('config.ufds is required'));
  }
  if (!config.mapi) {
    return callback(new TypeError('config.mapi is required'));
  }
  if (!log) {
    return callback(new TypeError('log is required'));
  }

  var mapi = new MAPI({
    username: config.mapi.username,
    password: config.mapi.password,
    url: config.mapi.uri,
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
      var app = new App({
        config: config,
        log: log,
        ufds: ufds,
        mapi: mapi
      });
    } catch(err) {
      return callback(err);
    }
    return callback(null, app);
  });
}

function App(opts) {
  var self = this;
  var config = opts.config;
  var log = opts.log;
  var ufds = opts.ufds;
  var mapi = opts.mapi;

  if (!config) throw TypeError('config is required');
  if (!config.port) throw TypeError('config.port is required');
  if (!config.dataCenterName) throw TypeError('config.dataCenterName is required');
  if (!ufds) throw TypeError('ufds is required');
  if (!mapi) throw TypeError('mapi is required');
  this.config = config;
  this.ufds = ufds;
  this.mapi = mapi;
  this.log = log;

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

  var server = this.server = restify.createServer({
    name: 'SmartDC Firewall API',
    version: constants.apiVersion
  });
  endpoints.registerEndpoints(server, this.log, before);
}

App.prototype.listen = function(callback) {
  this.server.listen(this.config.port, callback);
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

