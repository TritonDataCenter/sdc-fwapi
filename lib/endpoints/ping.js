/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * FWAPI: /ping endpoint
 */


'use strict';


// --- Endpoints



/**
 * /ping: return service status
 */
function ping(req, res, next) {
    var init = 'initializing';
    var off = 'offline';
    var on = 'online';
    var stats = {
        healthy: true,
        services: {
            fast: off,
            moray: off,
            ufds: off
        },
        status: 'OK'
    };

    if (req._ufds) {
        stats.services.ufds = req._ufds.connected ? on : off;
    } else {
        stats.services.ufds = init;
    }

    if (req._update) {
        stats.services.moray = req._update.morayConnected ? on : off;

        // Moray is up, but buckets haven't been created
        if (!req._update.initialized) {
            stats.services.moray = init;
        }

        if (req._update.listening) {
            stats.services.fast = on;
        }

    } else {
        stats.services.moray = init;
    }

    for (var s in stats.services) {
        if (stats.services[s] !== on) {
            if (stats.status !== off) {
                stats.status = stats.services[s];
            }
            stats.healthy = false;
        }

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
