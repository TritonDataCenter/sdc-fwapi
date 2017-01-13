/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Helpers for truncating test description output
 */

'use strict';

var clone = require('clone');


// --- Exports

/**
 * When adding potentially long text to a description, we truncate it so that
 * it can fit into the width of the screen without wrapping, which breaks up
 * the faucet output. Things usually fit, but rules containing VM UUIDs end
 * up being particularly long. We subtract 65 characters to allow for prefixes
 * to the generated description text, and the test number that faucet prints.
 *
 * If it doesn't look like we're using faucet (i.e., a test is being run
 * directly, or we're running integration tests), then we print everything.
 */
var USING_FAUCET = (!process.stdout.isTTY && process.stderr.isTTY);
var COLUMNS = USING_FAUCET ?
    (process.stderr.columns || 80) - 65 : Infinity;


/**
 * Sort the text 'rule' last, since it usually has the most useful
 * information in a description of parameters. UUIDs are randomly
 * generated, so the full string is usually not particularly useful
 * in test description messages, so we sort them to the beginning.
 */
function sortRuleLast(a, b) {
    if (a === 'rule') {
        return 1;
    }

    if (b === 'rule') {
        return -1;
    }

    var aIsUUID = (a.indexOf('uuid') !== -1);
    var bIsUUID = (b.indexOf('uuid') !== -1);

    if (aIsUUID && !bIsUUID) {
        return -1;
    }

    if (!aIsUUID && bIsUUID) {
        return 1;
    }

    return (a < b) ? -1 : 1;
}


/**
 * If needed, truncate the string fields of an object to fit within width,
 * and return a string representation of the object with the truncated
 * fields.
 *
 * This function isn't perfect: it's just an attempt to help produce
 * more reasonable descriptions in test output, and not break faucet.
 */
function truncateObject(orig, width) {
    var key, str;
    var obj = clone(orig);

    var keys = Object.keys(obj).sort(sortRuleLast);

    // width - curlies - commas
    var fitWithin = width - 2 - (keys.length - 1);

    // 4 quotes + colon
    var overhead = 5;

    // average length given to each key
    var avgLen = Math.floor(fitWithin / keys.length);

    function next() {
        str = JSON.stringify(obj);
        key = keys.shift();
        return key !== undefined;
    }

    while (next()) {
        if (str.length <= width) {
            return str;
        }

        if (typeof (obj[key]) !== 'string') {
            continue;
        }

        var escStrLen = JSON.stringify(obj[key]).length - 2;
        var okStrLen = avgLen - key.length - overhead;

        if (okStrLen <= 3) {
            obj[key] = '...';
            continue;
        } else if (escStrLen <= okStrLen) {
            continue;
        }

        var lopOff = escStrLen - okStrLen;

        obj[key] = obj[key].slice(0, obj[key].length - lopOff - 3) + '...';
    }

    return str;
}


/**
 * Truncate enough of a UUID to make it significantly shorter, but leave
 * enough so that it should still be distinguishable.
 */
function truncateUUID(uuid) {
    return uuid.slice(0, 15) + '...';
}


module.exports = {
    COLUMNS: COLUMNS,
    obj: truncateObject,
    uuid: truncateUUID
};
