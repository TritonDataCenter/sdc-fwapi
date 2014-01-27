/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Test helpers for FWAPI integration tests
 */

var async = require('async');
var common = require('../lib/common');
var FWAPI = require('sdc-clients/lib/fwapi');



/**
 * Create a FWAPI restify client
 */
function createClient() {
    return new FWAPI({
        agent: false,
        url: 'http://localhost'
    });
}


/**
 * Using FWAPI client `client`, delete every rule in array `rules`
 */
function deleteRules(t, client, rules, callback) {
    async.forEachSeries(rules, function (rule, cb) {
        var desc = ': ' + rule.rule;
        client.deleteRule(rule.uuid, function (err, obj, req, res) {
            t.ifError(err, 'rule delete' + desc);
            if (err) {
                return cb(err);
            }

            t.equal(res.statusCode, 204, 'status code' + desc);

            client.getRule(rules[0].uuid, function (err2, res2) {
                t.ok(err2, 'getRule error' + desc);
                if (!err2) {
                    return cb(err2);
                }

                t.deepEqual(err2.body, {
                    code: 'ResourceNotFound',
                    message: 'Rule not found'
                }, 'error body' + desc);

                return cb();
            });
        });

    }, function (err) {
        return callback(err);
    });
}



module.exports = {
    createClient: createClient,
    deleteRules: deleteRules,
    ifErr: common.ifErr,
    uuidSort: common.uuidSort
};
