/*
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 *
 * Object utilities
 */



// --- Exports



/**
 * Returns true if the object has no keys
 */
function isEmpty(obj) {
    /* JSSTYLED */
    /*jsl:ignore*/
    for (var k in obj) {
        return false;
    }
    /* JSSTYLED */
    /*jsl:end*/

    return true;
}



module.exports = {
    isEmpty: isEmpty
};
