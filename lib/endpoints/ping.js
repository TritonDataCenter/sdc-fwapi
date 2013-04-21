/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * FWAPI: /ping endpoint
 */



// --- Endpoints



/**
 * /ping: return service status
 */
function ping(req, res, next) {
    var stats = {
        healthy: true,
        services: {
            ufds: 'online',
            wfapi: 'online'
        },
        status: 'OK'
    };

    if (!req._ufds) {
        stats.services.ufds = 'offline';
        stats.status = 'initializing';
        stats.healthy = false;
    }

    if (!req._wfapi) {
        stats.services.wfapi = 'offline';
        stats.status = 'initializing';
        stats.healthy = false;
    }

    res.send(200, stats);
    return next();
}



// --- Exports



/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
    // We don't want to return 503 if any of the services are down: ping should
    // always report the status regardless
    var filtered = before.filter(function (f) {
        return (f.name !== 'checkServices');
    });

    http.get(
        { path: '/ping', name: 'getPing' }, filtered, ping);
    http.head(
        { path: '/ping', name: 'headPing' }, filtered, ping);
}



module.exports = {
    register: register
};
