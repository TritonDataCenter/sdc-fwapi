/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Update tests for /rules endpoints
 */

var async = require('async');
var mod_rule = require('../lib/rule');
var mod_uuid = require('node-uuid');
var util = require('util');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var OWNERS = [ mod_uuid.v4() ];
var RULES = [];



// --- Tests



exports['Add rule'] = function (t) {
    RULES.push({
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM all vms TO tag test BLOCK tcp PORT 8000'
    });

    mod_rule.create(t, {
        rule: RULES[0],
        exp: RULES[0]
    });
};


exports['Update rule'] = function (t) {
    var exp = [
    [
        'remove all vms',
        {
            rule: 'FROM ip 10.0.0.1 TO tag test BLOCK '
                + 'tcp PORT 8000'
        }

    ], [
        'add 2 IPs',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.2 OR ip 10.0.0.3) TO '
                + 'tag test BLOCK tcp PORT 8000'
        }

    ], [
        'remove 1 IP',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + 'tag test BLOCK tcp PORT 8000'
        }

    ], [
        'add a tag',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + '(tag test OR tag test2) BLOCK tcp PORT 8000'
        }

    ], [
        'add a value to a tag',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + '(tag test OR tag test2 = foo) BLOCK tcp PORT 8000'
        }

    ], [
        'add another value to a tag',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + '(tag test OR tag test2 = foo OR tag test2 = foo2) '
                + 'BLOCK tcp PORT 8000'
        }

    ], [
        'remove a tag and value',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + 'tag test BLOCK tcp PORT 8000'
        }

    ], [
        'replace a tag with all vms',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + 'all vms BLOCK tcp PORT 8000'
        }
    ]
    ];

    async.forEachSeries(exp, function (data, cb) {
        t.ok(data[0], '# ' + data[0]);
        mod_rule.updateAndGet(t, {
            uuid: RULES[0].uuid,
            params: data[1],
            partialExp: data[1]
        }, cb);
    }, function () {
        return t.done();
    });
};



// --- Teardown



exports.teardown = function (t) {
    mod_rule.delAllCreated(t);
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports.setup,
        setUp: exports.setUp,
        oneTest: runOne,
        teardown: exports.teardown
    };
}
