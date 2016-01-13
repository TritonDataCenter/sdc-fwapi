/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Constants
 */



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
    UUID_REGEX: UUID_REGEX,
    PARSED_FIELDS: PARSED_FIELDS
};
