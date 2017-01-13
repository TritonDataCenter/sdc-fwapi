/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Update tests for /rules endpoints
 */

'use strict';

var test = require('tape');
var async = require('async');
var mod_rule = require('../lib/rule');
var mod_uuid = require('node-uuid');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var OWNERS = [ mod_uuid.v4() ];
var RULES = [];



// --- Tests



test('Add rule', function (t) {
    RULES.push({
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM all vms TO tag "test" BLOCK tcp PORT 8000'
    });

    mod_rule.create(t, {
        rule: RULES[0],
        exp: RULES[0]
    });
});


test('Adding same rule again fails', function (t) {
    mod_rule.create(t, {
        rule: RULES[0],
        expCode: 422,
        expErr: mod_rule.alreadyExistsErr
    });
});


test('Update rule', function (t) {
    var exp = [
    [
        'remove all vms',
        {
            rule: 'FROM ip 10.0.0.1 TO tag "test" BLOCK '
                + 'tcp PORT 8000'
        }

    ], [
        'add 2 IPs',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.2 OR ip 10.0.0.3) TO '
                + 'tag "test" BLOCK tcp PORT 8000'
        }

    ], [
        'remove 1 IP',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + 'tag "test" BLOCK tcp PORT 8000'
        }

    ], [
        'add a tag',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + '(tag "test" OR tag "test2") BLOCK tcp PORT 8000'
        }

    ], [
        'add a value to a tag',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + '(tag "test" OR tag "test2" = "foo") BLOCK tcp PORT 8000'
        }

    ], [
        'add another value to a tag',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + '(tag "test" OR tag "test2" = "foo" OR tag "test2" = "foo2") '
                + 'BLOCK tcp PORT 8000'
        }

    ], [
        'remove a tag and value',
        {
            rule: 'FROM (ip 10.0.0.1 OR ip 10.0.0.3) TO '
                + 'tag "test" BLOCK tcp PORT 8000'
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
        return t.end();
    });
});



// --- Teardown



test('teardown', function (t) {
    mod_rule.delAllCreated(t);
});
