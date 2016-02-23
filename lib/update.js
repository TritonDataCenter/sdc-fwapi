/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Server for queuing updates and streaming them to clients
 */

var assert = require('assert-plus');
var mod_moray = require('./moray');
var stream = require('fast-stream');
var util = require('util');
var uuid = require('node-uuid');



// --- Globals



var BUCKET = {
    name: 'fwapi_updates',
    schema: {
        index: {
            host: { type: 'string' },
            uuid: { type: 'string', unique: true },
            _v: { type: 'number' }
        }
    }
};
var UPDATE_VERSION = 1;



// --- UpdateServer object



/**
 * UpdateServer constructor
 *
 * @param opts {Object} : configuration properties
 */
function UpdateServer(opts) {
    var self = this;

    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.config, 'opts.config');
    assert.number(opts.config.pollInterval, 'opts.config.pollInterval');
    assert.string(opts.config.host, 'opts.config.host');

    assert.object(opts.config.moray, 'opts.config.moray');
    assert.number(opts.config.moray.port, 'opts.config.moray.port');
    assert.string(opts.config.moray.host, 'opts.config.moray.host');

    assert.object(opts.config.fast, 'opts.config.fast');
    assert.number(opts.config.fast.port, 'opts.config.fast.port');

    this.config = opts.config;
    // XXX: get the servers from SAPI
    this.hosts = [ opts.config.host ];
    this.log = opts.log.child({ component: 'updater' });
    this.stream = stream.createServer({
        log: this.log,
        server_id: opts.config.host
    });
    this.timeout = null;
    this.moray = null;
    this.morayConnected = false;
    this.listening = false;
    this.initialized = false;

    this.__defineGetter__('clients', function () {
        return self.stream.state.clients;
    });
}


/**
 * Closes the fast server
 */
UpdateServer.prototype.close = function close() {
    if (this.timeout) {
        clearTimeout(this.timeout);
    }

    this.stream.close();
};


/**
 * Starts the fast server, initializes the moray updates bucket, and starts
 * polling moray for updates
 */
UpdateServer.prototype.init = function init(client) {
    var self = this;
    self.moray = client;
    self.morayConnected = true;

    this.stream.listen(this.config.fast.port, function () {
        self.log.info('fast-stream server listening on port %d',
            self.config.fast.port);
        self.listening = true;
    });

    // Moray's up, so we can now make sure all buckets are created
    mod_moray.initBucket(client, BUCKET, function (err) {
        if (err) {
            self.log.error(err, 'Error initializing buckets');
            return;
        }

        self.initialized = true;
        self.poll();
    });
};


/**
 * Sends a ping to all connected clients
 */
UpdateServer.prototype.ping = function ping() {
    var pingID = uuid.v1();
    this.stream.send({
        name: 'ping',
        value: { ping_id: pingID }
    });

    return {
        connected: this.clients,
        ping_id: pingID
    };
};


/**
 * Polls moray for updates, and sends them to all connected clients
 */
UpdateServer.prototype.poll = function poll() {
    var self = this;
    self.log.debug('poll: begin');

    var filter = '(&'
            + util.format('(host=%s)', self.config.host)
            + '(|'
                + '(!(_v=*))'
                + util.format('(_v=%d)', UPDATE_VERSION)
            + ')'
        + ')';

    var keys = [];
    var listOpts = {
        sort: {
            attribute: '_id',
            order: 'ASC'
        }
    };

    if (this.timeout) {
        clearTimeout(this.timeout);
    }

    function resetTimer() {
        self.timeout = setTimeout(self.poll.bind(self),
            self.config.pollInterval);
    }

    var req = this.moray.findObjects(BUCKET.name, filter, listOpts);

    req.on('error', function _onListErr(err) {
        self.morayConnected = false;
        req.removeAllListeners('record');
        req.removeAllListeners('end');
        self.log.error(err, 'moray error');
        resetTimer();
    });

    req.on('record', function _onListRecord(rec) {
        self.log.debug(rec, 'moray record');
        keys.push(rec.key);
        var toSend = {
            id: rec._id,
            name: rec.value.name,
            value: rec.value.value,
            req_id: rec.key
        };

        // For backwards compat
        if (rec.value.hasOwnProperty('payload')) {
            toSend.value = rec.value.payload;
        }

        self.stream.send(toSend);
    });

    req.on('end', function _onListEnd() {
        self.morayConnected = true;
        req.removeAllListeners('error');

        if (keys.length === 0) {
            self.log.debug('No updates for host %s in moray queue',
                self.config.host);
            resetTimer();
            return;
        }

        self.moray.batch(keys.map(function (k) {
            return {
                bucket: BUCKET.name,
                key: k,
                operation: 'delete'
            };
        }), function (err) {
            if (err) {
                self.log.error(err, 'Error batch deleting from moray');
            }

            self.log.info({ updateIDs: keys },
                'Processed %d updates', keys.length);
            resetTimer();
        });
    });
};


/**
 * Adds an update to the moray queue
 *
 * @param name {String} : update name
 * @param value {Object} : update data
 * @param callback {Function} `function (err)`
 */
UpdateServer.prototype.queue = function queueUpdate(name, value, callback) {
    var self = this;
    var updateUUID = uuid.v4();
    var batch = this.hosts.map(function (h) {
        return {
            bucket: BUCKET.name,
            key: updateUUID,
            operation: 'put',
            value: {
                _v: UPDATE_VERSION,
                host: self.config.host,
                name: name,
                value: value
            }
        };
    });

    this.moray.batch(batch, function (err, res) {
        if (err) {
            return callback(err);
        }

        return callback(null, { uuid: updateUUID, batch: res });
    });
};



// --- Exports



/**
 * Creates a new update server
 *
 * @param opts {Object} : As required by the UpdateServer constructor
 */
function createServer(opts) {
    return new UpdateServer(opts);
}



module.exports = {
    createServer: createServer
};
