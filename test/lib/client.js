/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test helpers for dealing with SDC clients
 */

var config = require('./config');
var RestifyClient = require('sdc-clients/lib/restifyclient');
var FWAPI = require('sdc-clients/lib/fwapi');
var NAPI = require('sdc-clients/lib/napi');
var VMAPI = require('sdc-clients/lib/vmapi');



// --- Globals



var CLIENTS = {};



// --- Exports



/**
 * Get a restify client of the given type
 */
function getClient(type) {
    if (!CLIENTS[type]) {
        switch (type) {
        case 'fwapi':
            CLIENTS.fwapi = new FWAPI(config.fwapi);
            break;
        case 'napi':
            CLIENTS.napi = new NAPI(config.napi);
            break;
        case 'vmapi':
            CLIENTS.vmapi = new VMAPI(config.vmapi);
            break;
        case 'wfapi':
            CLIENTS.wfapi = new RestifyClient(config.wfapi);
            break;
        default:
            throw new Error('Unknown client type + ' + type);
        }
    }

    // XXX: set x-request-id here?
    return CLIENTS[type];
}



module.exports = {
    get: getClient
};
