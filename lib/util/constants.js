/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Constants
 */


'use strict';


// --- Globals

var PARSED_FIELDS = [
    'parsed.action',
    'parsed.ports',
    'parsed.protocol',
    'parsed.tags'
];

var UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

module.exports = {
    DEFAULT_LIMIT: 1000,
    MAX_RETRIES: 5,
    RETRY_DELAY: 5000,

    UUID_REGEX: UUID_REGEX,
    PARSED_FIELDS: PARSED_FIELDS
};
