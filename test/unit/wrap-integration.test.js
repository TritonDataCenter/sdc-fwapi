/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Unit tests for /rules endpoints
 */

'use strict';

var test = require('tape');
var h = require('./helpers');
var mod_client = require('../lib/client');
var mod_log = require('../lib/log');



// --- Setup

mod_log.set(mod_log.selectUnitLogger());

test('setup', function (t) {
    h.createClientAndServer({}, function (err, res, moray) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        t.ok(moray, 'moray');
        mod_client.CLIENTS['fwapi'] = res;
        t.end();
    });
});


// --- Simple integration tests

require('../integration/get.test.js');
require('../integration/global.test.js');
require('../integration/list.test.js');
require('../integration/resolve.test.js');
require('../integration/update.test.js');


// --- Teardown

test('Stop server', h.stopServer);
