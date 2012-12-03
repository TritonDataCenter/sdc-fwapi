/*
 * Copyright (c) 2012 Joyent, Inc.  All rights reserved.
 *
 * Firewall API server app
 */

var assert = require('assert-plus');
var clone = require('clone');
var endpoints = require('./endpoints');
var fs = require('fs');
var pipeline = require('./pipeline').pipeline;
var restify = require('restify');
var UFDS = require('sdc-clients').UFDS;
var WFAPI = require('wf-client');



// --- Globals



var VERSION = '0.0.1';
var WORKFLOW_PATH = './lib/workflows/';



// --- Internal helpers



/**
 * Throws an error if options passed to createApp() are invalid
 */
function validateOpts(opts) {
  assert.object(opts, 'opts');
  assert.object(opts.config, 'opts.config');
  assert.object(opts.config.ufds, 'opts.config.ufds');
  assert.object(opts.config.wfapi, 'opts.config.wfapi');
  assert.number(opts.config.port, 'opts.config.port');
  assert.string(opts.config.datacenter, 'opts.config.datacenter');

  assert.object(opts.log, 'opts.log');

  return;
}


/**
 * Waits for workflow init to complete, retrying as necessary
 */
function waitForWorkflowInit(wfapi, log, callback) {
  var timeout = null;
  wfapi.initWorkflows(function (err) {
    if (err) {
      log.error(err, 'Error loading workflows: retrying');

      if (!timeout) {
          waitForWorkflowInit.call(wfapi, callback);
      }
    } else {
        clearTimeout(timeout);
        timeout = null;
        log.info('Loaded workflows');
        return callback(null, wfapi);
    }
  });

  function timeoutCallback() {
    waitForWorkflowInit.call(wfapi, log, callback);
  }

  timeout = setTimeout(timeoutCallback, 10000);
}


/**
 * Creates the workflow client
 */
function createWorkflowClient(opts, callback) {
  var conf = clone(opts.config.wfapi);
  conf.path = __dirname + '/workflows';
  fs.readdir(conf.path, function (err, files) {
    conf.workflows = files.map(function (f) {
      return f.replace('.js', '')
    }).filter(function (f) { return !(f == 'common') });

    // XXX: might want to remove this once things have stabilized a bit:
    conf.forceReplace = true;
    opts.log.info(conf, 'Creating workflow client');
    conf.log = opts.log;

    var wfapi = new WFAPI(conf);
    return waitForWorkflowInit(wfapi, opts.log, callback);
  });
}


/**
 * Creates the UFDS client
 */
function createUFDSclient(opts, callback) {
  var conf = clone(opts.config.ufds);
  opts.log.info(conf, 'Creating UFDS client');
  conf.log = opts.log;

  var client = new UFDS(conf);
  client.once('error', function (e) {
    opts.log.error(err, 'Error connecting to UFDS');
    return callback(e);
  });

  client.once('ready', function () {
    return callback(null, client);
  });
}



// --- FWAPI object and methods



/**
 * FWAPI Constructor
 */
function FWAPI(opts) {
  var self = this;

  assert.object(opts.config, 'opts.config');
  assert.object(opts.log, 'opts.log');
  assert.object(opts.ufds, 'opts.ufds');
  assert.object(opts.wfapi, 'opts.wfapi');

  this.config = opts.config;
  this.log = opts.log;
  this.ufds = opts.ufds;
  this.wfapi = opts.wfapi;

  // Runs before every request
  function setup(req, res, next) {
    req.log = self.log;
    req._app = self;
    req._datacenter = self.config.datacenter;
    req._ufds = self.ufds;
    req._wfapi = self.wfapi;
    return next();
  }

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

  endpoints.registerEndpoints(server, self.log, [setup]);
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

  pipeline({
    funcs: [
      function wf(_, cb) { createWorkflowClient(opts, cb) },
      function ufds(_, cb) { createUFDSclient(opts, cb) },
    ]
  }, function (err, res) {
    if (err) {
      return callback(err);
    }

    try {
      var app = new FWAPI({
        config: opts.config,
        log: opts.log,
        ufds: res.state.ufds,
        wfapi: res.state.wf
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
