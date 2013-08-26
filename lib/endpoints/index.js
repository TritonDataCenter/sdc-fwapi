/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Handles loading all restify endpoints for FWAPI
 */



/*
 * Endpoints are in their own individual files, in a directory structure
 * that roughly matches their routes, eg: /rules -> rules.js
 */
var toRegister = {
    '/firewalls/vms/:uuid': require('./firewalls/vms'),
    '/ping': require('./ping'),
    '/resolve': require('./resolve'),
    '/rules': require('./rules'),
    '/rules/:uuid/vms': require('./rules/vms'),
    '/updates': require('./updates')
};



// --- Exports



/*
 * Register all endpoints with the restify server
 */
function registerEndpoints(http, log, before) {
    for (var t in toRegister) {
        log.debug('Registering endpoints for "%s"', t);
        toRegister[t].register(http, before);
    }
}



module.exports = {
    registerEndpoints: registerEndpoints
};
