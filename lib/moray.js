/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Moray convenience functions
 */

var moray = require('moray');
var VError = require('verror').VError;

/**
 * Creates a new moray client, setting up reconnection logic in the
 * process
 *
 * @param config {Object}
 * @param parentLog {Bunyan Logger Object}
 * @param callback {Function} `function (err, client)`
 */
function createClient(config, parentLog, callback) {
    var conf = {
        connectTimeout: 1000,
        host: config.host,
        noCache: true,
        port: config.port,
        reconnect: true,
        retry: {
            retries: Infinity,
            maxTimeout: 6000,
            minTimeout: 100
        }
    };

    conf.log = parentLog.child({
        component: 'moray',
        level: config.logLevel || parentLog.level()
    });
    conf.log.debug(conf, 'Creating moray client');
    var client = moray.createClient(conf);

    function onMorayConnect() {
        client.removeListener('error', onMorayError);
        client.log.info('moray: connected');
        client.on('error', function (err) {
            // not much more to do because the moray client should take
            // care of reconnecting, etc.
            client.log.error(err, 'moray client error');
        });
        return callback(null, client);
    }

    function onMorayError(err) {
        client.removeListener('connect', onMorayConnect);
        client.log.error(err, 'moray: connection failed');
        return callback(err);
    }

    function onMorayConnectAttempt(number, delay) {
        var level;
        if (number === 0) {
            level = 'info';
        } else if (number < 5) {
            level = 'warn';
        } else {
            level = 'error';
        }
        client.log[level]({
                attempt: number,
                delay: delay
        }, 'moray: connection attempted');
    }

    client.once('connect', onMorayConnect);
    client.once('error', onMorayError);
    client.on('connectAttempt', onMorayConnectAttempt); // this we always use
}


/**
 * Initializes a moray bucket
 *
 * @param client {MorayClient}
 * @param bucket {Object} : Bucket schema object, as required by
 *     createBucket()
 * @param callback {Function} `function (err)`
 */
function initBucket(client, bucket, callback) {
    var att = 1;
    var timeout = null;

    function initRetry() {
        client.putBucket(bucket.name, bucket.schema, function (err) {
            if (timeout) {
                clearTimeout(timeout);
            }

            if (!err) {
                return callback();
            }

            client.log.error(err, 'Error initializing buckets (attempt=%d)',
                att);
            att++;
            timeout = setTimeout(initRetry, 10000);
        });
    }

    function versionCheck() {
        client.version({ log: client.log }, function (v) {
            if (bucket.hasOwnProperty('morayVersion') &&
                bucket.morayVersion > v) {
                client.log.error('Moray is at version %d but bucket ' +
                    '"%s" requires Moray version %d; will check again in ' +
                    '10 seconds', v, bucket.name, bucket.morayVersion);
                setTimeout(versionCheck, 10000);
                return;
            }

            initRetry();
        });
    }

    versionCheck();
}



module.exports = {
    create: createClient,
    initBucket: initBucket
};
