/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Test helpers for FWAPI integration tests
 */

var common = require('../lib/common');



// --- Exports



module.exports = {
    ifErr: common.ifErr,
    uuidSort: common.uuidSort
};
