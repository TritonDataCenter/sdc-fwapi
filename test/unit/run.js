/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 * Copyright 2014, Patrick Mooney.
 */

'use strict';

var assert = require('assert');
var fs = require('fs');
var h = require('./helpers');
var path = require('path');
var test = require('tape');

function runTests(directory) {
    h.MULTI_SUITE_RUN = true;

    fs.readdir(directory, function (err, files) {
        assert.ifError(err);
        files.filter(function (f) {
            return (/\.test\.js$/.test(f));
        }).map(function (f) {
            return (path.join(directory, f));
        }).forEach(require);

        test('Shutdown Postgres', function (t) {
            h.stopPG();
            t.end();
        });
    });
}

// --- Run All Tests

(function main() {
    runTests(__dirname);
})();
