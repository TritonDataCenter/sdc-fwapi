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
    var initInProgress = false;
    var stats = {
        healthy: true,
        services: {
            fast: 'offline',
            moray: 'offline',
            ufds: 'online'
        },
        status: 'OK'
    };

    if (!req._ufds) {
        stats.services.ufds = 'offline';
        initInProgress = true;
    }

    if (req._update) {
        if (req._update.moray && req._update.moray.morayConnected) {
            stats.services.moray = 'online';
        }

        // Moray is up, but buckets haven't been created
        if (!req._update.initialized) {
            initInProgress = true;
        }

        if (req._update.listening) {
            stats.services.fast = 'online';
        }

    } else {
        initInProgress = true;
    }

    if (initInProgress) {
        stats.status = 'initializing';
        stats.healthy = false;
    }

    if (req.params.agents && req._update) {
        stats.agents = req._update.ping();
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
