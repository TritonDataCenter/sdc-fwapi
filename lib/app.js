/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

/*
 * Firewall API server application
 */

'use strict';

var assert = require('assert-plus');
var endpoints = require('./endpoints');
var fs = require('fs');
var http = require('http');
var https = require('https');
var mod_jsprim = require('jsprim');
var mod_migrate = require('./moray-migration');
var mod_moray = require('./moray');
var mod_rule = require('./rule');
var mod_update = require('./update');
var mod_vasync = require('vasync');
var os = require('os');
var path = require('path');
var restify = require('restify');
var UFDS = require('ufds');
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
                errs.length === 1 ? errs[0].message : 'Services unavailable');
            err.errors = errs;
            return next(err);
        }

        return next();
    }

    var server = this.server = restify.createServer({
        log: opts.log,
        name: 'SmartDC Firewall API',
        handleUncaughtExceptions: false,
        version: VERSION
    });
    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.bodyParser());
    server.use(restify.queryParser());
    server.use(restify.requestLogger());

    // Start the tracing backend and instrument this restify 'server'.
    tritonTracer.restifyServer.init({log: opts.log, restifyServer: server});

    // TODO: use for low probability in restify server tracing
    // var EVT_SKIP_ROUTES = {
        // 'getping': true,
        // 'headping': true
    // };

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
        if (route && (route.name === 'getping' || route.name === 'headping')) {
            return;
        }

        restify.auditLogger({
            log: req.log.child({
                component: 'audit',
                route: route && route.name
            }, true),
            // Successful GET res bodies are uninteresting and *big*.
            body: !((req.method === 'GET') &&
                Math.floor(res.statusCode / 100) === 2)
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
        if (self.moray) {
            self.moray.close();
        }

        if (!self.ufds) {
            callback();
            return;
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

FWAPI.prototype.initializeClients = function initializeClients(callback) {
    var self = this;
    mod_vasync.parallel({
        'funcs': [
            function initUFDS(cb) {
                if (self.ufds === null) {
                    self.ufdsClientInit(cb);
                } else {
                    cb();
                }
            },
            function initVMAPI(cb) {
                if (self.vmapi === null) {
                    self.vmapiClientInit(cb);
                } else {
                    cb();
                }
            },
            function initMoray(cb) {
                if (self.moray === null) {
                    self.morayClientInit(cb);
                } else {
                    cb();
                }
            }
        ]
    }, function (err) {
        if (err) {
            self.log.error(err,
                'Failed to fully initialize clients; retrying in 5 seconds');
            setTimeout(self.initializeClients.bind(self), 5000, callback);
            return;
        }

        mod_moray.initialize({
            app: self,
            log: self.log,
            moray: self.moray,
            buckets: [ mod_rule.BUCKET, mod_update.BUCKET ]
        }, function (err2) {
            if (err2) {
                self.log.error(err2, 'Failed to initialize buckets cleanly');
                callback(err2);
                return;
            }

            mod_migrate.migrate(self, self.log, function (err3) {
                if (err3) {
                    self.log.error(err3, 'Failed to finish migration cleanly');
                    callback(err3);
                    return;
                }

                self.updater.init(self.moray, callback);
            });
        });
    });
};

/**
 * Starts the server
 */
FWAPI.prototype.listen = function listen(callback) {
    var self = this;
    mod_vasync.parallel({ funcs: [
        function (cb) {
            self.server.listen(self.config.port, cb);
        },
        function (cb) {
            self.initializeClients(cb);
        }
    ] }, callback);
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
    var conf = mod_jsprim.deepCopy(this.config.ufds);
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
    var conf = mod_jsprim.deepCopy(this.config.vmapi);
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
    var conf = mod_jsprim.deepCopy(self.config.moray);

    mod_moray.create(conf, self.log, function (err, client) {
        if (client) {
            self.moray = client;
        }

        /*
         * If there was an error, we've already logged it
         * in the moray module.
         */
        cb(err);
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
function createApp(opts) {
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
