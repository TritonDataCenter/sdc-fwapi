/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Common test helpers shared between integration and unit tests
 */



// --- Exports



/**
 * Finish a test
 */
function done(err, res, t, callback) {
    if (callback) {
        return callback(err, res);
    }

    return t.done();
}


/**
 * Calls t.ifError, outputs the error body for diagnostic purposes, and
 * returns true if there was an error
 */
function ifErr(t, err, desc) {
    t.ifError(err, desc);
    if (err) {
        t.deepEqual(err.body, {}, desc + ': error body');
        return true;
    }

    return false;
}


/**
 * Sort by rule UUID
 */
function uuidSort(a, b) {
    return (a.uuid > b.uuid) ? 1 : -1;
}



module.exports = {
    done: done,
    ifErr: ifErr,
    uuidSort: uuidSort
};
