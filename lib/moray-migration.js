/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * These functions are for migrating firewall rules out of UFDS and into Moray
 */

var fw = require('./rule');

var fmt = require('util').format;

var UFDS_BUCKET = 'ufds_o_smartdc';
var FWRULE_FILTER = '(objectclass=fwrule)';

/*
 * UFDS stores all fields as arrays. Because we're going around behind its back
 * (since UFDS doesn't support pagination), we'll have to clean it up.
 */
function cleanupObject(obj) {
    var raw = {};
    for (var k in obj) {
        if (Array.isArray(obj[k]) && obj[k].length === 1) {
            raw[k] = obj[k][0];
        } else {
            raw[k] = obj[k];
        }
    }
    return raw;
}

/*
 * Create a batch of rules all at once
 */
function createRules(app, log, rules, callback) {
    try {
        var batch = rules.map(function (rule) {
            var raw = new fw.Rule(rule, app).raw();
            return {
                bucket: fw.BUCKET.name,
                key: raw.uuid,
                value: raw
            };
        });
        app.moray.batch(batch, {}, callback);
    } catch (e) {
        callback(e);
    }
}


function migrateBatch(app, log, marker, callback) {
    var count = 0;
    var rules = [];
    var info = { startPoint: marker };
    var filter = marker === null ? FWRULE_FILTER :
        fmt('(&%s(uuid>=%s)(!(uuid=%s)))', FWRULE_FILTER, marker, marker);

    var req = app.moray.findObjects(UFDS_BUCKET, filter, {
        sort: {
            attribute: 'uuid',
            order: 'ASC'
        },
        limit: 5000
    });

    req.once('error', function (err) {
        log.error(err, info,
            'Migration failed after migrating %d rules; aborting', count);
        return callback(err);
    });
    req.on('record', function (obj) {
        var clean = cleanupObject(obj.value);
        marker = clean.uuid;
        rules.push(clean);
        count++;
    });
    req.on('end', function () {
        if (count === 0) {
            return callback();
        }

        createRules(app, log, rules, function (err) {
            if (err) {
                log.error(err, info, 'Batch failed');
                return callback(err);
            }

            log.info(info, 'Batch succeeded; migrated %d rules.', count);
            migrateBatch(app, log, marker, callback);
        });
    });
}

function migrate(app, log, callback) {
    if (app.config.fwrule_version <= 2) {
        return callback();
    }

    log.info('Starting migration');
    migrateBatch(app, log, null, function (err) {
        if (err) {
            return callback(err);
        }

        log.info('Migration completed successfully; deleting rules in UFDS');
        app.moray.deleteMany(UFDS_BUCKET, FWRULE_FILTER, {
            noLimit: true
        }, callback);
    });
}

module.exports = {
    migrate: migrate
};
