/*
 * Copyright (c) 2012 Joyent, Inc.  All rights reserved.
 *
 * Firewall API server app
 */

var assert = require('assert-plus');
var clone = require('clone');
var endpoints = require('./endpoints');
var restify = require('restify');
var UFDS = require('sdc-clients').UFDS;



// --- Globals



var VERSION = '0.0.1';



// --- Internal helpers



/**
 * Throws an error if options passed to createApp() are invalid
 */
function validateOpts(opts) {
  assert.object(opts, 'opts');
  assert.object(opts.config, 'opts.config');
  assert.object(opts.config.ufds, 'opts.config.ufds');
  assert.number(opts.config.port, 'opts.config.port');
  assert.string(opts.config.datacenter, 'opts.config.datacenter');

  assert.object(opts.log, 'opts.log');

  return;
}


// --- FWAPI object



/**
 * FWAPI Constructor
 */
function FWAPI(opts) {
  var self = this;

  assert.object(opts.config, 'opts.config');
  assert.object(opts.log, 'opts.log');
  assert.object(opts.ufds, 'opts.ufds');

  this.config = opts.config;
  this.ufds = opts.ufds;
  this.log = opts.log;

  // Runs before every request
  function setup(req, res, next) {
    req.log = self.log;
    req._ufds = self.ufds;
    req._app = self;
    req._datacenter = self.config.datacenter;
    return next();
  }

  var before = [setup];

  var server = this.server = restify.createServer({
    name: 'SmartDC Firewall API',
    version: VERSION
  });
  server.use(restify.acceptParser(server.acceptable));
  server.use(restify.bodyParser());
  server.use(restify.queryParser());
  server.on('after', restify.auditLogger({
    log: self.log.child({component: 'audit'}),
    body: true
  }));
  endpoints.registerEndpoints(server, self.log, before);
}


/**
 * Close this app.
 *
 * @param {Function} callback called when closed. Takes no arguments.
 */
FWAPI.prototype.close = function close(callback) {
  var self = this;
  this.server.on('close', function() {
    self.ufds.close(function(err) {
      self.log.error(err, 'Error closing UFDS connection');
      return callback();
    });
  });
  this.server.close();
};


/**
 * Starts the server
 */
FWAPI.prototype.listen = function listen(callback) {
  return this.server.listen(this.config.port, callback);
};



// --- Exports



/**
 * Create the app.
 *
 * @param opts {Object} Options:
 * - `config` {Object}: config (required)
 * - `log` {Object}: bunyan logger (required)
 * @param callback {Function} `function (err, app) {...}`.
 */
function createApp(opts, callback) {
  try {
    validateOpts(opts);
  } catch (err) {
    return callback(err);
  }

  var conf = clone(opts.config.ufds);
  opts.log.info(conf, 'Creating UFDS client');
  conf.log = opts.log;

  var client = new UFDS(conf);
  client.once('error', function (e) {
    return callback(e);
  });

  client.once('ready', function _newFWAPI() {
    try {
      var app = new FWAPI({
        config: opts.config,
        log: opts.log,
        ufds: client
      });
    } catch(err) {
      return callback(err);
    }

    return callback(null, app);
  });
}



module.exports = {
  create: createApp
};
