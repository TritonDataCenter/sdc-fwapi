/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Test helpers for dealing with SDC clients
 */

'use strict';

var config = require('./config');
var RestifyClient = require('sdc-clients/lib/restifyclient');
var CNAPI = require('sdc-clients/lib/cnapi');
var FWAPI = require('sdc-clients/lib/fwapi');
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
        case 'cnapi':
            CLIENTS.cnapi = new CNAPI(config.cnapi);
            break;
        case 'fwapi':
            CLIENTS.fwapi = new FWAPI(config.fwapi);
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
    CLIENTS: CLIENTS,
    get: getClient
};
