/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Firewall API server application
 */

var assert = require('assert-plus');
var clone = require('clone');
var endpoints = require('./endpoints');
var fs = require('fs');
var http = require('http');
var https = require('https');
var mod_update = require('./update');
var os = require('os');
var path = require('path');
var restify = require('restify');
var trace_event = require('trace-event');
var UFDS = require('ufds');
var verror = require('verror');
var VMAPI = require('sdc-clients').VMAPI;



// --- Globals



var VERSION = JSON.parse(fs.readFileSync(path.normalize(
    __dirname + '/../package.json'), 'utf8')).version;



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

    var maxSockets = opts.config.maxHttpSockets || 100;
    opts.log.debug('Setting maxSockets to %d', maxSockets);
    http.globalAgent.maxSockets = maxSockets;
    https.globalAgent.maxSockets = maxSockets;

    // Runs before every request
    function setup(req, res, next) {
        req._app = self;
        req._ufds = self.ufds;
        req._vmapi = self.vmapi;
        req._update = self.updater;

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

        if (errs.length !== 0) {
            var err = new restify.ServiceUnavailableError(
                errs.length == 1 ? errs[0].message : 'Services unavailable');
            err.errors = errs;
            return next(err);
        }

        return next();
    }

    var server = this.server = restify.createServer({
        log: opts.log,
        name: 'SmartDC Firewall API',
        version: VERSION
    });
    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.bodyParser());
    server.use(restify.queryParser());
    server.use(restify.requestLogger());

    var EVT_SKIP_ROUTES = {
        'getping': true,
        'headping': true
    };
    server.use(function (req, res, next) {
        req.trace = trace_event.createBunyanTracer({
            log: req.log
        });
        if (req.route && !EVT_SKIP_ROUTES[req.route.name]) {
            req.trace.begin(req.route.name);
        }
        next();
    });
    server.on('after', function (req, res, route, err) {
        if (route && !EVT_SKIP_ROUTES[route.name]) {
            req.trace.end(route.name);
        }
    });

    server.use(function _headers(req, res, next) {
        res.on('header', function onHeader() {
            var now = Date.now();
            res.header('Date', new Date());
            res.header('Server', server.name);
            res.header('x-request-id', req.getId());
            var t = now - req.time();
            res.header('x-response-time', t);
            res.header('x-server-name', os.hostname());
        });

        return next();
    });

    server.on('after', function _filteredAuditLog(req, res, route, err) {
        // Don't log ping requests, to avoid filling up the log
        if (route && (route.name == 'getping' || route.name == 'headping')) {
            return;
        }

        restify.auditLogger({
            log: req.log.child({
                component: 'audit',
                route: route && route.name
            }, true),
            // Successful GET res bodies are uninteresting and *big*.
            body: !((req.method === 'GET') &&
                Math.floor(res.statusCode/100) === 2)
        })(req, res, route, err);
    });

    server.on('uncaughtException', function (req, res, route, err) {
        delete err.domain;
        req.log.error(err, 'Uncaught exception');
        res.send(new verror.WError(err, 'Internal error'));
    });

    endpoints.registerEndpoints(server, self.log, [setup, checkServices]);

    this.updater = mod_update.createServer({
        config: {
            host: os.hostname(),
            pollInterval: self.config.pollInterval,
            moray: self.config.moray,
            fast: self.config.fast
        },
        log: self.log
    });
}


/**
 * Close this app.
 *
 * @param {Function} callback called when closed. Takes no arguments.
 */
FWAPI.prototype.close = function close(callback) {
    var self = this;
    this.server.on('close', function () {
        if (!self.ufds) {
            return callback();
        }

        self.ufds.close(function (err) {
            if (err) {
                self.log.error(err, 'Error closing UFDS connection');
            }

            return callback();
        });
    });

    this.server.close();
    this.updater.close();
};


/**
 * Starts the server
 */
FWAPI.prototype.listen = function listen(callback) {
    this.server.listen(this.config.port, callback);

    if (!this.ufds) {
        this.ufdsClientInit();
    }

    if (!this.vmapi) {
        this.vmapiClientInit();
    }

    this.updater.init();
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
 * Creates the UFDS client
 */
FWAPI.prototype.ufdsClientInit = function ufdsClientInit() {
    var self = this;
    var conf = clone(this.config.ufds);
    conf.log = this.log;
    var client = new UFDS(conf);

    client.once('connect', function () {
        self.log.info('UFDS client ready');
        self.ufds = client;
    });
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
    assert.number(opts.config.port, 'opts.config.port');

    assert.object(opts.log, 'opts.log');

    return new FWAPI({
        config: opts.config,
        log: opts.log
    });
}



module.exports = {
    create: createApp
};
