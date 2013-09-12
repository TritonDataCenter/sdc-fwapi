/*
 * Copyright (c) 2013 Joyent, Inc.  All rights reserved.
 *
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

        client.log.info(err, 'createBucket: bucket %s already exists',
            bucket.name);
        client.updateBucket(bucket.name, bucket.schema, callback);
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
