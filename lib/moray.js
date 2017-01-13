/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Moray convenience and initialization functions
 *
 *
 * Migration of old records is performed by constructing the corresponding
 * model using the existing parameters stored in moray, then calling `raw()` to
 * get the new record to put into moray. Since migration only uses the new model
 * to construct new instances, you must be able to create new, valid records
 * from the parameters in the old records.
 *
 *
 * Migrating a bucket involves the following steps:
 * 1. Check and update bucket schema and version, if needed.
 * 2. Re-index objects. This needs to be done before re-putting objects,
 *    otherwise when new indexes are added, any existing values will be
 *    nullified when we get them from Moray.
 * 3. Re-put objects.
 *
 * Every step happens for each bucket every time FWAPI starts. Since FWAPI could
 * have crashed during re-indexing or re-putting, we run both each time to check
 * for any records that still need to be processed.
 */

'use strict';

var assert = require('assert-plus');
var async = require('async');
var clone = require('clone');
var constants = require('./util/constants');
var mod_moray = require('moray');
var util = require('util');
var vasync = require('vasync');
var VError = require('verror');


// --- Internal


function assertCommonOpts(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.app, 'opts.app');
    assert.object(opts.log, 'opts.log');
    assert.object(opts.moray, 'opts.moray');
    assert.optionalObject(opts.extra, 'opts.extra');
}


function assertBucket(bucket) {
    assert.object(bucket, 'opts.bucket');
    assert.func(bucket.constructor, 'opts.bucket.constructor');
    assert.string(bucket.name, 'opts.bucket.name');
    assert.number(bucket.version, 'opts.bucket.version');
    assert.number(bucket.morayVersion, 'opts.bucket.morayVersion');
    assert.object(bucket.schema, 'opts.bucket.schema');
    assert.object(bucket.schema.index, 'opts.bucket.schema.index');
    assert.object(bucket.schema.index._v, 'opts.bucket.schema.index._v');
}


function batchAll(recs) {
    var batch = [];
    recs.forEach(function (r) {
        var b = r.batch({ migration: true });
        if (Array.isArray(b)) {
            batch = batch.concat(b);
        } else {
            batch.push(b);
        }
    });

    return batch;
}


/**
 * Initialize a bucket in Moray if it doesn't exist yet. If the bucket already
 * exists and is an older version of the schema, update the schema. If the
 * schema is newer that what we have, log and do nothing.
 */
function putBucket(opts, callback) {
    var moray = opts.moray;
    var bucket = opts.bucket;
    var log = opts.log;

    var schema = clone(bucket.schema);
    schema.options = schema.options || {};
    schema.options.version = bucket.version;

    function retry(err, msg) {
        var info = {
            err: err,
            retries: opts.retries,
            delay: constants.RETRY_DELAY,
            bucket: bucket.name
        };

        if (opts.retries >= constants.MAX_RETRIES) {
            log.error(info, 'putBucket: %s', msg);
            callback(err);
        } else {
            opts.retries += 1;
            log.error(info, 'putBucket: %s; will retry', msg);
            setTimeout(putBucket, constants.RETRY_DELAY, opts, callback);
        }
    }

    moray.getBucket(bucket.name, function (gErr, bucketObj) {
        if (gErr) {
            if (!VError.hasCauseWithName(gErr, 'BucketNotFoundError')) {
                retry(gErr, 'error getting bucket');
                return;
            }

            moray.createBucket(bucket.name, schema, function (cErr) {
                if (cErr) {
                    retry(cErr, 'error creating bucket');
                } else {
                    log.info({ schema: schema, bucket: bucket.name },
                        'putBucket: created bucket');
                    callback();
                }
            });
            return;
        }

        var version =
            (bucketObj.options ? bucketObj.options.version : 0) || 0;

        if (bucket.version <= version) {
            var msg = bucket.version < version ?
                'bucket has a newer schema; not updating' :
                'bucket up to date';

            log.info({
                bucket: bucket.name,
                existing: version,
                current: bucket.version
            }, 'putBucket: %s', msg);

            callback();
            return;
        }

        log.info({ existing: bucketObj, current: bucket },
            'putBucket: updating bucket');

        moray.updateBucket(bucket.name, schema, function (uErr) {
            if (uErr) {
                retry(uErr, 'error updating bucket');
                return;
            }

            log.info({
                bucket: bucket.name,
                old: version,
                current: bucket.version
            }, 'putBucket: bucket updated');

            callback();
        });
    });
}


/**
 * Reindex all of the objects within a bucket.
 */
function reindex(opts, callback) {
    var bucket = opts.bucket;
    var log = opts.log;
    var moray = opts.moray;

    var processed = 0;
    var count = 100;

    var options = {
        noBucketCache: true
    };

    function retry(err, msg) {
        var info = {
            err: err,
            retries: opts.retries,
            delay: constants.RETRY_DELAY,
            bucket: bucket.name
        };

        if (opts.retries >= constants.MAX_RETRIES) {
            log.error(info, 'reindex: %s', msg);
            callback(err);
        } else {
            opts.retries += 1;
            log.error(info, 'reindex: %s; will retry', msg);
            setTimeout(_reindex, constants.RETRY_DELAY);
        }
    }

    function processResults(rErr, res) {
        if (rErr) {
            retry(rErr, 'error reindexing objects');
            return;
        }

        if (res.processed > 0) {
            log.info({
                bucket: bucket.name,
                processed: processed,
                cur: res.processed
            }, 'reindex: records reindexed');

            processed += res.processed;
            setImmediate(_reindex);
            return;
        }

        var msg = (processed === 0 ?
            'reindex: records already reindexed' :
            'reindex: all records reindexed');
        log.info({ bucket: bucket.name }, msg);

        callback();
    }

    function _reindex() {
        moray.reindexObjects(bucket.name, count, options, processResults);
    }

    _reindex();
}


/**
 * Find all old records in a bucket and upgrade them to the latest version of
 * the object.
 */
function updateRecords(opts, callback) {
    var bucket = opts.bucket;
    var app = opts.app;
    var log = opts.log;
    var moray = opts.moray;
    var extra = opts.extra;

    var processed = 0;

    function retry(err, msg) {
        var info = {
            err: err,
            retries: opts.retries,
            delay: constants.RETRY_DELAY,
            bucket: bucket.name
        };

        if (opts.retries >= constants.MAX_RETRIES) {
            log.error(info, 'updateRecords: %s', msg);
            callback(err);
        } else {
            opts.retries += 1;
            log.error(info, 'updateRecords: %s; will retry', msg);
            setTimeout(_updateRecords, constants.RETRY_DELAY);
        }
    }

    function processResults(listErr, recs) {
        if (listErr) {
            retry(listErr, 'failed to list records');
            return;
        }

        if (recs.length === 0) {
            // No more unmigrated records
            var msg = (processed === 0 ?
                'updateRecords: records already migrated' :
                'updateRecords: all records migrated');
            log.info({
                bucket: bucket.name,
                version: bucket.version,
                processed: processed
            }, msg);
            callback();
            return;
        }

        var batch = batchAll(recs);

        log.debug({
            batch: batch,
            bucket: bucket.name
        }, 'updateRecords: batch');

        moray.batch(batch, function (batchErr) {
            if (batchErr) {
                if (VError.hasCauseWithName(batchErr, 'EtagConflictError')) {
                    // One of the batch objects has been updated from
                    // underneath us: try it again next time.
                    setImmediate(_updateRecords);
                    return;
                }

                retry(batchErr, 'failed to commit batch');
                return;
            }

            // Migration succeeded - keep going
            processed += batch.length;
            log.info({
                bucket: bucket.name,
                processed: processed,
                cur: batch.length
            }, 'updateRecords: records migrated');
            setImmediate(_updateRecords);
        });
    }

    function _updateRecords() {
        listObjs({
            app: app,
            extra: extra,
            filter: util.format('(|(!(_v=*))(_v<=%d))', bucket.version - 1),
            log: log,
            bucket: bucket,
            model: bucket.constructor,
            moray: moray,
            noBucketCache: true
        }, processResults);
    }

    _updateRecords();
}


/**
 * Ensures a bucket has been created, and takes care of updating it and its
 * contents if it already exists.
 *
 * @param opts {Object]:
 * - `moray`: {Moray Client}
 * - `bucket` {Object}: bucket definition
 * - `log` {Bunyan logger}
 * - `extra` {Object} (optional): extra parameters to pass to constructor
 * @param callback {Function} `function (err)`
 */
function initializeBucket(opts, callback) {
    assertCommonOpts(opts);
    assertBucket(opts.bucket);
    assert.func(callback, 'callback');

    var bucket = opts.bucket;
    var log = opts.log;

    log.info('begin migration for bucket %s', bucket.name);
    vasync.pipeline({
        funcs: [ putBucket, reindex, updateRecords ],
        arg: {
            app: opts.app,
            bucket: bucket,
            extra: opts.extra || {},
            log: log,
            moray: opts.moray,
            retries: 0
        }
    }, function (err, res) {
        if (err) {
            callback(err);
            return;
        }

        log.trace({ bucket: bucket.name, res: res }, 'migration complete');
        log.info('end migration for bucket %s', bucket.name);
        callback();
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
    // XXX: Determine & enforce a minimum required Moray version.
    var conf = {
        connectTimeout: 1000,
        host: config.host,
        noCache: true,
        port: config.port,
        reconnect: true,
        retry: {
            maxTimeout: 6000,
            minTimeout: 100
        }
    };

    conf.log = parentLog.child({
        component: 'moray',
        level: config.logLevel || parentLog.level()
    });
    conf.log.debug(conf, 'Creating moray client');
    waitForConnect(mod_moray.createClient(conf), callback);
}


/**
 * Wait for a Moray client to issue a 'connect' or 'error' event. Log a message
 * every time a connection attempt is made.
 */
function waitForConnect(client, callback) {
    function onMorayConnect() {
        client.removeListener('error', onMorayError);
        client.log.info('moray: connected');
        client.on('error', function (err) {
            // not much more to do because the moray client should take
            // care of reconnecting, etc.
            client.log.error(err, 'moray client error');
        });
        callback(null, client);
    }

    function onMorayError(err) {
        client.removeListener('connect', onMorayConnect);
        client.log.error(err, 'moray: connection failed');
        callback(err);
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
 * Lists objects in moray
 *
 * @param opts {Object}
 * - `bucket` {Bucket schema object}
 * - `filter` {String}
 * - `limit` {Integer}
 * - `log` {Bunyan Logger}
 * - `offset` {Integer}
 * - `moray` {MorayClient}
 * - `sort` {Object} (optional)
 * - `model` {Object} (optional)
 * - `noBucketCache` {Boolean} (optional)
 * - `extra` {Object} (optional) extra params to pass to constructor
 * @param callback {Function} `function (err, netObj)`
 */
function listObjs(opts, callback) {
    assertCommonOpts(opts);
    assert.object(opts.bucket, 'opts.bucket');
    assert.string(opts.filter, 'opts.filter');
    assert.optionalFunc(opts.model, 'opts.model');
    assert.optionalObject(opts.sort, 'opts.sort');
    assert.optionalNumber(opts.limit, 'opts.limit');
    assert.optionalNumber(opts.offset, 'opts.offset');
    assert.optionalBool(opts.noBucketCache, 'opts.noBucketCache');
    assert.func(callback, 'callback');

    var results = [];
    var listOpts = {};

    if (opts.sort) {
        listOpts.sort = opts.sort;
    }

    if (opts.limit) {
        listOpts.limit = opts.limit;
    } else {
        listOpts.limit = constants.DEFAULT_LIMIT;
    }

    if (opts.offset) {
        listOpts.offset = opts.offset;
    }

    if (opts.noBucketCache) {
        listOpts.noBucketCache = true;
    }

    opts.log.debug({ filter: opts.filter }, 'listObjs: Querying Moray');

    var req = opts.moray.findObjects(opts.bucket.name, opts.filter, listOpts);

    req.on('error', callback);

    req.on('record', function _onListRec(rec) {
        opts.log.trace({ record: rec }, 'record from Moray');
        if (opts.extra) {
            Object.keys(opts.extra).forEach(function (k) {
                rec.value[k] = opts.extra[k];
            });
        }
        results.push(rec);
    });

    req.on('end', function _endList() {
        if (opts.model) {
            async.map(results, function (rec, cb) {
                try {
                    cb(null, new opts.model(rec, opts.app));
                } catch (e) {
                    cb(e);
                }
            }, callback);
        } else {
            callback(null, results);
        }
    });
}


/**
 * Migrates records in the buckets for each of the provided models.
 *
 * @param opts {Object}:
 * - `moray` {Moray Client}
 * - `log` {Bunyan logger}
 * - `buckets` {Array}: array of bucket objects for each model
 *  e.g. [ { constructor: mod_rule.Rule, name: 'fwapi_rules', ... } ]
 * - `extra` {Object} (optional): extra params to pass to constructors
 * @param callback {Function} `function (err)`
 */
function initializeBuckets(opts, callback) {
    assertCommonOpts(opts);
    assert.arrayOfObject(opts.buckets, 'opts.buckets');
    assert.func(callback, 'callback');

    vasync.forEachPipeline({
        func: function migrateOne(bucket, cb) {
            initializeBucket({
                app: opts.app,
                log: opts.log,
                extra: opts.extra,
                moray: opts.moray,
                bucket: bucket
            }, cb);
        },
        inputs: opts.buckets
    }, function (err, res) {
        opts.log.debug({ err: err, res: res }, 'migration results');
        callback(err);
    });
}


module.exports = {
    create: createClient,
    initialize: initializeBuckets,
    listObjs: listObjs,
    waitForConnect: waitForConnect
};
