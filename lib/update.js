/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

/*
 * Server for queuing updates and streaming them to clients
 */

'use strict';

var assert = require('assert-plus');
var stream = require('fast-messages');
var util = require('util');
var uuid = require('uuid');


var hasKey = require('jsprim').hasKey;


// --- Globals


/*
 * We assign a version number to objects so that older versions can be found
 * and upgraded in the future.
 *
 * 1 - Initial version.
 * 2 - Index on "name"
 */
var UPDATE_RAW_VERSION = 1;

var BUCKET = {
    name: 'fwapi_updates',
    constructor: UpdateMsg,
    version: UPDATE_RAW_VERSION,
    schema: {
        index: {
            uuid: { type: 'string', unique: true },
            host: { type: 'string' },
            name: { type: 'string' },
            _v: { type: 'number' }
        }
    },
    morayVersion: 1
};



// --- UpdateServer object



/**
 * UpdateServer constructor
 *
 * @param opts {Object} : configuration properties
 */
function UpdateServer(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.config, 'opts.config');
    assert.number(opts.config.pollInterval, 'opts.config.pollInterval');
    assert.string(opts.config.host, 'opts.config.host');

    assert.object(opts.config.fast, 'opts.config.fast');
    assert.number(opts.config.fast.port, 'opts.config.fast.port');

    this.config = opts.config;
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
}


Object.defineProperty(UpdateServer.prototype, 'clients', {
    get: function () { return this.stream.state.clients; }
});


/**
 * Closes the fast server
 */
UpdateServer.prototype.close = function close() {
    if (this.timeout) {
        clearTimeout(this.timeout);
    }

    if (this.initialized) {
        this.initialized = false;
        this.stream.close();
    }
};


/**
 * Starts the fast server, initializes the moray updates bucket, and starts
 * polling moray for updates
 */
UpdateServer.prototype.init = function init(client, callback) {
    var self = this;
    self.moray = client;
    self.morayConnected = true;

    this.stream.listen(this.config.fast.port, function () {
        self.log.info('fast-stream server listening on port %d',
            self.config.fast.port);
        self.listening = true;
        self.initialized = true;
        self.poll();
        callback();
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

    if (!self.initialized) {
        self.log.warn('poll: not initialized, skipping poll');
        return;
    }

    self.log.debug('poll: begin');

    var filter = util.format('(&(host=%s)(|(!(_v=*))(_v=%d)))',
        self.config.host, UPDATE_RAW_VERSION);

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
        if (hasKey(rec.value, 'payload')) {
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
    var updateUUID = uuid.v4();
    var update = new UpdateMsg({
        key: updateUUID,
        value: {
            host: this.config.host,
            name: name,
            value: value
        }
    });

    this.moray.batch([ update.batch() ], function (err, res) {
        if (err) {
            callback(err);
            return;
        }

        callback(null, { uuid: updateUUID });
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


function UpdateMsg(record, app) {
    assert.object(record, 'record');
    assert.uuid(record.key, 'record.key');
    assert.object(record.value, 'record.value');
    assert.string(record.value.name, 'record.value.name');
    assert.object(record.value.value, 'record.value.name');
    assert.optionalString(record.etag, 'record.key');

    this.uuid = record.key;
    this.data = record.value;
    this.etag = record.etag || null;
    this.app = app;

    Object.seal(this);
}


UpdateMsg.prototype.rawMoray = function () {
    return {
        uuid: this.uuid,
        host: this.data.host,
        name: this.data.name,
        value: this.data.value,
        _v: UPDATE_RAW_VERSION
    };
};


UpdateMsg.prototype.batch = function () {
    var raw = this.rawMoray();
    return {
        bucket: BUCKET.name,
        key: raw.uuid,
        operation: 'put',
        value: raw,
        options: {
            etag: this.etag
        }
    };
};


module.exports = {
    BUCKET: BUCKET,
    createServer: createServer,
    UpdateMsg: UpdateMsg
};
