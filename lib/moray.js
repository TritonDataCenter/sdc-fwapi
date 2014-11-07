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



// --- Internal



/**
 * Initializes a bucket in moray: creating it if it doesn't exist, updating
 * its schema if it does exist
 *
 * @param client {MorayClient}
 * @param bucket {Object} : Bucket schema object, with at least `name` and
 *     `schema` members
 * @param callback {Function} `function (err)`
 */
function createBucket(client, bucket, callback) {
    client.getBucket(bucket.name, function (err) {
        if (err) {
            if (err.name === 'BucketNotFoundError') {
                client.log.info(bucket.schema,
                    'createBucket: creating bucket %s', bucket.name);
                return client.createBucket(bucket.name, bucket.schema,
                    callback);
            }

            client.log.error(err, 'createBucket: error getting bucket %s',
                bucket.name);
            return callback(err);
        }

        client.log.info(err, 'createBucket: bucket %s already exists: updating',
            bucket.name);

        client.updateBucket(bucket.name, bucket.schema, function (err2) {
            if (err) {
                client.log.error(err, 'createBucket: error updating bucket %s',
                    bucket.name);
            } else {
                client.log.info({
                    bucketName: bucket.name,
                    schema: bucket.schema
                }, 'createBucket: successfully updated bucket');
            }

            return callback(err2);
        });
    });
}



// --- Exports



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
        createBucket(client, bucket, function (err) {
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

    initRetry();
}



module.exports = {
    create: createClient,
    initBucket: initBucket
};
