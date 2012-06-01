/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Handles loading all restify endpoints for FWAPI
 */

/*
 * Endpoints are in their own individual files, in a directory structure
 * that roughly matches their routes, eg:
 *   /networks -> networks.js
 *   /networks/:network_uuid/ips -> networks/ips.js
 */
var toRegister = {
  '/firewalls/': require('./firewalls'),
  '/ping': require('./ping'),
  '/rules': require('./rules'),
};



/*
 * Register all endpoints with the restify server
 */
function registerEndpoints(http, log, before) {
  for (var t in toRegister) {
    log.debug("Registering endpoints for '%s'", t);
    toRegister[t].register(http, before);
  }
}



module.exports = {
  registerEndpoints: registerEndpoints
};
