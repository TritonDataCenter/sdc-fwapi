/*
 * Copyright (c) 2013 Joyent, Inc.  All rights reserved.
 *
 * Streams update events to clients
 */

var assert = require('assert-plus');
var fast = require('fast');
var uuid = require('node-uuid');



// --- StreamServer object



/**
 * StreamServer constructor
 *
 * @param opts {Object} : with the following required properties:
 *     - log {Object} : Bunyan logger
 *     - server_id {Object} : UUID of this host
 */
function StreamServer(opts) {
    var self = this;

    assert.object(opts, 'opts');
    assert.string(opts.server_id, 'opts.server_id');
    assert.object(opts.log, 'opts.log');

    this.clients = {};
    this.log = opts.log.child({ component: 'stream' });
    this.server_id = opts.server_id;
    this.server = fast.createServer({ log: this.log });

    this.server.on('error', function onError(err) {
        self.log.error(err, 'fast server error');
    });

    this.server.on('clientError', function onClientError(err) {
        self.log.error(err, 'fast client error');
    });

    this.server.on('connection', function onConnect(sock) {
        self.log.info('connected: ' + sock.remoteAddress);
    });

    this.registerHandlers();
    this.log.info({ maxConnections: this.server.maxConnections },
        'fast server created');
}


/**
 * Closes the fast server
 */
StreamServer.prototype.close = function close(port, callback) {
    this.server.close();
};


/**
 * Listens on the given port
 *
 * @param port {Number} : Port number to listen on
 * @param callback {Function} `function (err)`
 */
StreamServer.prototype.listen = function listen(port, callback) {
    assert.number(port);
    this.port = port;

    return this.server.listen(port, callback);
};


/**
 * Registers fast handlers for ping and updates
 */
StreamServer.prototype.registerHandlers = function register() {
    var self = this;

    function messagesHandler(opts, res) {
        var clientID = opts.client_id;
        if (!clientID) {
            clientID = uuid.v1();
            self.log.info('unidentified client "%s" added', clientID);
        } else {
            self.log.info('client "%s" added', clientID);
        }

        res.on('end', function () {
            self.log.debug('connection to %s closed', clientID);
            delete self.clients[clientID];
        });

        self.clients[clientID] = res;
    }

    function pingHandler(opts, res) {
        var log = self.log.child({
            component: 'fast',
            req_id: opts.req_id || uuid.v1()
        });

        log.info(opts, 'ping');
        res.end();
    }

    this.server.rpc('messages', messagesHandler);
    this.server.rpc('ping', pingHandler);
};


/**
 * Sends an update to all connected clients
 *
 * @param opts {Object} : with the following properties:
 *     - id {Number} : Sequence number of this update (Optional)
 *     - name {String} : Name of the update
 *     - payload {Object} : Update data to send
 *     - req_id {UUID} : Request UUID (Optional)
 */
StreamServer.prototype.send = function send(opts) {
    var message = {
        id: opts.id,
        name: opts.name,
        req_id: opts.req_id || uuid.v1(),
        server_id: this.server_id,
        value: opts.payload
    };

    for (var conn in this.clients) {
        var res = this.clients[conn];
        this.log.debug(message, 'sending message to "%s"', conn);
        res.write(message);
    }
};



// --- Exports



/**
 * Creates a new stream server
 *
 * @param opts {Object} : As required by the StreamServer constructor
 */
function createServer(opts) {
    return new StreamServer(opts);
}



module.exports = {
    createServer: createServer
};
