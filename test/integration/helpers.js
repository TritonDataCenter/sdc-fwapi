/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Test helpers for FWAPI integration tests
 */

var common = require('../lib/common');
var FWAPI = require('sdc-clients/lib/fwapi');


function createClient() {
    return new FWAPI({
        agent: false,
        url: 'http://localhost'
    });
}



module.exports = {
    createClient: createClient,
    ifErr: common.ifErr,
    uuidSort: common.uuidSort
};
