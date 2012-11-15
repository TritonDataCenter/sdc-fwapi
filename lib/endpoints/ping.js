/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * FWAPI: /ping endpoint
 */



// --- Endpoints



/*
 * /ping: return service status
 */
function ping(req, res, next) {
  var status = { status: 'OK' };
  res.send(200, status);
  return next();
}



// --- Exports



/*
 * Register all endpoints with the restify server
 */
function register(http, before) {
  http.get(
    { path: '/ping', name: 'getPing' }, before, ping);
  http.head(
    { path: '/ping', name: 'headPing' }, before, ping);
}



module.exports = {
  register: register
};
