/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Array utilities
 */

'use strict';

var util = require('util');



// --- Exports




/**
 * Turn a value into an array, unless it is one already.
 */
function splitToArray(obj) {
    if (util.isArray(obj)) {
        return obj;
    }

    if (obj === '') {
        return [];
    }

    return obj.split(',');
}



module.exports = {
    splitToArray: splitToArray
};
