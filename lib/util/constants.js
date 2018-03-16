/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Shared constants
 */


'use strict';


// --- Globals

var PARSED_FIELDS = [
    'parsed.action',
    'parsed.ports',
    'parsed.protocol',
    'parsed.tags'
];

var MESSAGES = {
    INVALID_PARAMS: 'Invalid parameters',
    ARRAY_OF_STR: 'must be an array of strings',
    ARRAY_EMPTY: 'must not be an empty array',
    STR: 'must be a string',
    OBJ: 'must be an object',
    INVALID_UUID: 'invalid UUID',
    OFFSET: 'invalid value, offset must be an integer greater than or ' +
        'equal to 0',
    LIMIT: 'invalid limit, must be an integer greater than 0 or less than or ' +
        'equal to 1000'
};

module.exports = {
    DEFAULT_LIMIT: 1000,
    MAX_RETRIES: 5,
    RETRY_DELAY: 5000,
    PARSED_FIELDS: PARSED_FIELDS,
    msg: MESSAGES,
    MAX_LIMIT: 1000,
    MAX_STR_LEN: 64,
    MIN_LIMIT: 1,
    MIN_OFFSET: 0
};
