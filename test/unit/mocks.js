/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Mock objects for FWAPI unit tests
 */

var EventEmitter = require('events').EventEmitter;
var mod_uuid = require('node-uuid');
var util = require('util');
var VError = require('verror').VError;



// --- Globals



var LOG;
var VMAPI_VMS = [];
var UFDS_RULES = {};
var CNAPI_SERVERS = {};
var TASKS = {};



// --- Internal helpers


/**
 * Returns a CNAPI-style provisioner task response
 */
function taskResponse() {
    var taskID = mod_uuid.v4();
    TASKS[taskID] = { status: 'complete' };
    return { id: taskID };
}



// --- sdc-clients: CNAPI



function fakeCNAPIclient() {

}


fakeCNAPIclient.prototype.getTask = function (id, callback) {
    if (!TASKS.hasOwnProperty(id)) {
        return callback(new Error('Unkown task ID: ' + id));
    }

    return callback(null, TASKS[id]);
};


fakeCNAPIclient.prototype.post = function (endpoint, params, callback) {
    var method;
    var routes = [
        [ new RegExp('/servers/([^/]+)/fw/add'), this._handleFwAdd],
        [ new RegExp('/servers/([^/]+)/fw/update'), this._handleFwUpdate],
        [ new RegExp('/servers/([^/]+)/fw/del'), this._handleFwDel]
    ];
    var serverUUID;

    for (var r in routes) {
        var match = endpoint.match(routes[r][0]);
        if (match) {
            serverUUID = match[1];
            method = routes[r][1];
        }
    }

    if (!method) {
        return callback(new Error('Unknown endpoint: ' + endpoint));
    }

    if (!CNAPI_SERVERS.hasOwnProperty(serverUUID)) {
        CNAPI_SERVERS[serverUUID] = {};
    }

    LOG.debug(params, '%s: server "%s": "%s"', endpoint, serverUUID);

    return method(serverUUID, params, callback);
};


fakeCNAPIclient.prototype._handleFwAdd =
    function (serverUUID, params, callback) {
    var server = CNAPI_SERVERS[serverUUID];
    if (!server.hasOwnProperty('rules')) {
        server.rules = {};
    }

    // XXX: not strictly true
    if (!params.hasOwnProperty('rules')) {
        return callback(new Error('/fw/add payload did not have rules'));
    }

    params.rules.forEach(function (rule) {
        server.rules[rule.uuid] = rule;
    });

    return callback(null, taskResponse());
};


fakeCNAPIclient.prototype._handleFwDel =
    function (serverUUID, params, callback) {
    var server = CNAPI_SERVERS[serverUUID];

    // XXX: the real provisioner task doesn't return an error if there are
    // no rules
    if (!server.hasOwnProperty('rules')) {
        return callback(
            new VError('/fw/del: server "%s" does not have any rules',
                serverUUID));
    }

    if (!params.hasOwnProperty('uuids')) {
        return callback(new Error('/fw/del payload did not have uuids'));
    }

    var notFound = [];
    params.uuids.forEach(function (uuid) {
        if (!server.rules.hasOwnProperty(uuid)) {
            notFound.push(uuid);
        }
        delete server.rules[uuid];
    });

    // XXX: same as above - the real provisioner task doesn't return an error if
    // these rules don't exist. This is for testing only.
    if (notFound.length !== 0) {
        return callback(
            new VError('/fw/del: server "%s" does not have rules: %s',
                serverUUID, notFound));
    }

    return callback(null, taskResponse());
};


fakeCNAPIclient.prototype._handleFwUpdate =
    function (serverUUID, params, callback) {
    var server = CNAPI_SERVERS[serverUUID];
    if (!server.hasOwnProperty('rules')) {
        return callback(
            new VError('/fw/update: server "%s" does not have any rules',
                serverUUID));
    }

    if (!params.hasOwnProperty('rules')) {
        return callback(new Error('/fw/update payload did not have rules'));
    }

    params.rules.forEach(function (rule) {
        server.rules[rule.uuid] = rule;
    });

    return callback(null, taskResponse());
};



// --- sdc-clients: UFDS



function fakeUFDSclient() {
    var self = this;
    EventEmitter.call(this);
    process.nextTick(function () {
        self.emit('ready');
    });
}

util.inherits(fakeUFDSclient, EventEmitter);


function ruleUUIDfromDN(dn) {
    /* JSSTYLED */
    var ruleUUID = dn.match(/uuid=([^,]+),/);
    return ruleUUID ? ruleUUID[1] : null;
}


fakeUFDSclient.prototype.add = function (dn, raw, callback) {
    var ruleUUID = ruleUUIDfromDN(dn);
    if (ruleUUID) {
        UFDS_RULES[ruleUUID] = raw;
    }

    return callback(null);
};


fakeUFDSclient.prototype.del = function (dn, callback) {
    var ruleUUID = ruleUUIDfromDN(dn);
    if (ruleUUID) {
        if (!UFDS_RULES.hasOwnProperty(ruleUUID)) {
            return callback(
                new VError('Rule "%s" does not exist in UFDS', ruleUUID));
        }
        delete UFDS_RULES[ruleUUID];
    }

    return callback(null);
};


fakeUFDSclient.prototype.close = function (callback) {
    return callback();
};


fakeUFDSclient.prototype.modify = function (dn, change, callback) {
    var ruleUUID = ruleUUIDfromDN(dn);
    if (ruleUUID) {
        UFDS_RULES[ruleUUID] = change.modification;
    }

    return callback(null);
};


fakeUFDSclient.prototype.search = function (dn, opts, callback) {
    if (opts.scope === 'base') {
        var ruleUUID = ruleUUIDfromDN(dn);
        var rule = UFDS_RULES[ruleUUIDfromDN(dn)];
        if (!ruleUUID || !rule) {
            return callback(null, []);
        }
        return callback(null, [ rule ]);
    }

    return callback(new Error('xxxx'));
};



// --- sdc-clients: VMAPI


function fakeVMAPIclient() {

}



fakeVMAPIclient.prototype.listVms = function (params, callback) {
    // XXX: filter here!
    return callback(null, VMAPI_VMS);
};



module.exports = {
    // -- mocks
    'sdc-clients': {
        CNAPI: fakeCNAPIclient,
        UFDS: fakeUFDSclient,
        VMAPI: fakeVMAPIclient
    },

    // -- mock data
    set _LOGGER(val) {
        LOG = val;
    },
    get _SERVERS() {
        return CNAPI_SERVERS;
    },
    set _SERVERS(val) {
        CNAPI_SERVERS = val;
    },
    get _VMS() {
        return VMAPI_VMS;
    },
    set _VMS(val) {
        VMAPI_VMS = val;
    }
};
