/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Handles loading all restify endpoints for FWAPI
 */


'use strict';


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
