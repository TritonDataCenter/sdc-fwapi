/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
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
var mod_migrate = require('./moray-migration');
var mod_moray = require('./moray');
var mod_rule = require('./rule');
var mod_update = require('./update');
var mod_vasync = require('vasync');
var os = require('os');
var path = require('path');
var restify = require('restify');
var Tracer = require('triton-tracer');
var UFDS = require('ufds');
var verror = require('verror');
var VMAPI = require('sdc-clients').VMAPI;



// --- Globals



var VERSION = JSON.parse(fs.readFileSync(path.normalize(
    __dirname + '/../package.json'), 'utf8')).version;
var request_seq_id = 0;


function getClient(clientName, req) {
    assert.object(req, 'req');
    assert.object(req._app, 'req._app');
    assert.object(req._app[clientName], 'req._app[' + clientName + ']');

    // shortcut for non-restify clients which we don't yet wrap
    if (clientName === 'ufds') {
        return (req._app.ufds);
    } else if (clientName === 'moray') {
        return (req._app.moray);
    }

    // We only want to create one child client for each type of client per
    // request (since the trace data will be the same) so if we already created
    // a child, we'll return that.
    if (!req.clientChildren) {
        req.clientChildren = {};
    }

    if (!req.clientChildren[clientName]) {
        req.log.debug('creating child for ' + clientName);
        req.clientChildren[clientName] = req._app[clientName].child(req);
    }

    return (req.clientChildren[clientName]);
}


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
        req._moray = self.moray;
        req._update = self.updater;

        return next();
    }

    function checkServices(req, res, next) {
        var errs = [];
        if (req._ufds === null) {
            errs.push({
                code: 'ServiceUnavailable',
                message: 'UFDS client not initialized'
            });
        }

        if (req._moray === null) {
            errs.push({
                code: 'ServiceUnavailable',
                message: 'Moray client not initialized'
            });
        }

        if (!req._update.initialized) {
            errs.push({
                code: 'ServiceUnavailable',
                message: 'Updater not initialized'
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

    // Start the tracing backend and instrument this restify 'server'.
    Tracer.restifyServer.init({log: opts.log, restifyServer: server});

    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.bodyParser());
    server.use(restify.queryParser());
    server.use(restify.requestLogger());

    server.use(function (req, res, next) {
        // this will return a client if called as req.getClient('vmapi')
        req.getClient = function _getClient(clientName) {
            return getClient(clientName, req);
        };
        next();
    });

    var EVT_SKIP_ROUTES = {
        'getping': true,
        'headping': true
    };

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

    endpoints.registerEndpoints(server, self.log, [setup, checkServices]);

    this.ufds = null;
    this.vmapi = null;
    this.moray = null;
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

FWAPI.prototype.initializeClients = function initializeClients() {
    var self = this;
    mod_vasync.parallel({
        'funcs': [
            function initUFDS(cb) {
                if (self.ufds === null) {
                    self.ufdsClientInit(cb);
                } else return cb();
            },
            function initVMAPI(cb) {
                if (self.vmapi === null) {
                    self.vmapiClientInit(cb);
                } else return cb();
            },
            function initMoray(cb) {
                if (self.moray === null) {
                    self.morayClientInit(cb);
                } else return cb();
            }
        ]
    }, function (err) {
        if (err) {
            self.log.error(err,
                'Failed to fully initialize clients; retrying in 5 seconds');
            setTimeout(self.initializeClients.bind(self), 5000);
            return;
        }

        mod_migrate.migrate(self, self.log, function (err2) {
            if (err2) {
                self.log.error(err2, 'Failed to finish migration cleanly');
                return;
            }

            self.updater.init(self.moray);
        });
    });
};

/**
 * Starts the server
 */
FWAPI.prototype.listen = function listen(callback) {
    this.server.listen(this.config.port, callback);
    this.initializeClients();
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
FWAPI.prototype.ufdsClientInit = function ufdsClientInit(cb) {
    var self = this;
    var conf = clone(this.config.ufds);
    conf.log = this.log;
    var client = new UFDS(conf);

    client.once('error', function (err) {
        self.log.error(err, 'UFDS failed to initialize');
        return cb(err);
    });
    client.once('connect', function () {
        client.removeAllListeners('error');
        self.log.info('UFDS client ready');
        self.ufds = client;
        return cb();
    });
};


/**
 * Creates the VMAPI client
 */
FWAPI.prototype.vmapiClientInit = function vmapiClientInit(cb) {
    var self = this;
    var conf = clone(this.config.vmapi);
    conf.log = self.log.child({ component: 'vmapiClient', level: 'trace' });

    // XXX: retry here, calling /ping?
    self.vmapi = new VMAPI(conf);
    return cb();
};


/**
 * Creates the Moray client
 */
FWAPI.prototype.morayClientInit = function morayClientInit(cb) {
    var self = this;
    var conf = clone(self.config.moray);

    mod_moray.create(conf, self.log, function (err, client) {
        if (err) {
            // We've already logged in the moray module - nothing to do
            return cb(err);
        }

        self.moray = client;

        mod_moray.initBucket(client, mod_rule.BUCKET, function (err2) {
            if (err2) {
                self.log.error(err2, 'Error initializing buckets');
                return;
            }

            return cb();
        });
    });
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
