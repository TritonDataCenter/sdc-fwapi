/*
 * Copyright (c) 2013 Joyent, Inc.  All rights reserved.
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
var verror = require('verror');
var VMAPI = require('sdc-clients').VMAPI;
var WFAPI = require('wf-client');



// --- Globals



var VERSION = '0.0.1';
var WORKFLOW_PATH = './lib/workflows/';



// --- FWAPI object and methods



/**
 * FWAPI Constructor
 */
function FWAPI(opts) {
  var self = this;

  assert.object(opts.config, 'opts.config');
  assert.object(opts.log, 'opts.log');

  this.config = opts.config;
  this.log = opts.log;

  // Runs before every request
  function setup(req, res, next) {
    req.log = self.log;
    req._app = self;
    req._datacenter = self.config.datacenter;
    req._ufds = self.ufds;
    req._vmapi = self.vmapi;
    req._wfapi = self.wfapi;

    return next();
  }

  function checkServices(req, res, next) {
    var errs = [];
    if (!req._ufds) {
      errs.push({
        code: 'ServiceUnavailable',
        message: 'UFDS client not initialized'
      });
    }

    if (!req._wfapi) {
      errs.push({
        code: 'ServiceUnavailable',
        message: 'WFAPI client not initialized'
      });
    }

    if (errs.length !== 0) {
      var err = new restify.ServiceUnavailableError(
        errs.length == 1 ? errs[0].message : 'Services unavailable');
      err.errors = errs;
      return next(err);
    }

    return next();
  }

  var server = this.server = restify.createServer({
    name: 'SmartDC Firewall API',
    version: VERSION
  });
  server.use(restify.acceptParser(server.acceptable));
  server.use(restify.bodyParser());
  server.use(restify.queryParser());

  var auditLog = restify.auditLogger({
    log: self.log.child({ component: 'audit' })
  });

  server.on('after', function _filteredAuditLog(req, res, route, err) {
    // Don't log ping requests, to avoid filling up the log
    if (route !== 'getping' && route !== 'headping') {
      auditLog(req, res, route, err);
    }
  });

  server.on('uncaughtException', function (req, res, route, err) {
    delete err.domain;
    req.log.error(err, 'Uncaught exception');
    res.send(new verror.WError(err, 'Internal error'));
  });

  endpoints.registerEndpoints(server, self.log, [setup, checkServices]);
}


/**
 * Close this app.
 *
 * @param {Function} callback called when closed. Takes no arguments.
 */
FWAPI.prototype.close = function close(callback) {
  var self = this;
  this.server.on('close', function() {
    self.ufds.close(function (err) {
      if (err) {
        self.log.error(err, 'Error closing UFDS connection');
      }

      return callback();
    });
  });

  this.server.close();
};


/**
 * Starts the server
 */
FWAPI.prototype.listen = function listen(callback) {
  this.server.listen(this.config.port, callback);

  if (!this.wfapi) {
    this.workflowClientInit();
  }

  if (!this.ufds) {
    this.ufdsClientInit();
  }

  if (!this.vmapi) {
    this.vmapiClientInit();
  }
};


/**
 * Return server information
 */
FWAPI.prototype.info = function info() {
  var addr = this.server.address();
  addr.name = this.server.name;
  addr.url = this.server.url;

  return addr;
};


/**
 * Waits for workflow init to complete, retrying as necessary
 */
FWAPI.prototype.waitForWorkflowInit = function waitForWorkflowInit(wfapi) {
  var self = this;
  var att = 1;
  var timeout = null;

  function initWorkFlowRetry() {
    self.log.debug('Initializing workflows: attempt %d', att);
    wfapi.initWorkflows(function (err) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      if (!err) {
        self.log.info('Loaded workflows');
        self.wfapi = wfapi;
        return;
      }

      self.log.error(err, 'Error loading workflows (attempt: %d): retrying',
        att);
      att++;
      timeout = setTimeout(initWorkFlowRetry, 10000);
    });
  }

  initWorkFlowRetry();
};


/**
 * Creates the workflow client
 */
FWAPI.prototype.workflowClientInit = function workflowClientInit() {
  var self = this;
  var conf = clone(this.config.wfapi);
  conf.path = __dirname + '/workflows';
  fs.readdir(conf.path, function (err, files) {
    if (err) {
      throw err;
    }

    conf.workflows = files.map(function (f) {
      return f.replace('.js', '')
    }).filter(function (f) { return !(f == 'common') });

    // XXX: might want to remove this once things have stabilized a bit:
    conf.forceReplace = true;
    self.log.info(conf, 'Creating workflow client');
    conf.log = self.log.child({ component: 'wfclient' });
    if (!conf.hasOwnProperty('retry')) {
      conf.retry = {
        retries: Infinity,
        maxTimeout: 6000,
        minTimeout: 100
      };
    }

    return self.waitForWorkflowInit(new WFAPI(conf));
  });
};


/**
 * Creates the UFDS client
 */
FWAPI.prototype.ufdsClientInit = function ufdsClientInit() {
  var self = this;
  var att = 1;
  var conf = clone(this.config.ufds);
  var timeout = null;

  conf.log = this.log;

  function initUFDSretry() {
    self.log.debug('Initializing UFDS client: attempt %d', att);

    var client = new UFDS(conf);
    client.once('error', function (e) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      self.log.error(e, 'Error loading workflows (attempt: %d): retrying',
        att);
      att++;
      timeout = setTimeout(initUFDSretry, 10000);
    });

    client.once('ready', function () {
      self.log.info('UFDS client ready');
      self.ufds = client;
    });
  }

  initUFDSretry();
};


/**
 * Creates the VMAPI client
 */
FWAPI.prototype.vmapiClientInit = function vmapiClientInit() {
  var self = this;
  var conf = clone(this.config.vmapi);
  conf.log = self.log.child({ component: 'vmapiClient', level: 'trace' });

  // XXX: retry here, calling /ping?
  self.vmapi = new VMAPI(conf);
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
  assert.object(opts, 'opts');
  assert.object(opts.config, 'opts.config');
  assert.object(opts.config.ufds, 'opts.config.ufds');
  assert.object(opts.config.wfapi, 'opts.config.wfapi');
  assert.number(opts.config.port, 'opts.config.port');
  assert.string(opts.config.datacenter, 'opts.config.datacenter');

  assert.object(opts.log, 'opts.log');

  return new FWAPI({
    config: opts.config,
    log: opts.log
  });
}



module.exports = {
  create: createApp
};
