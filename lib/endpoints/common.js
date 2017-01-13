/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Shared code between restify endpoints
 */

'use strict';

var mod_err = require('../errors');
var mod_persist = require('../persist');


var hasKey = require('jsprim').hasKey;


// --- Exports

/**
 * Restify 'before' handler:
 * * gets an existing rule from UFDS and stores it in req._rule
 * * makes sure the user is allowed to modify the rule by checking owner_uuid
 */
function ruleBefore(req, res, next) {
    mod_persist.getRule(req._app, req.log, req.params.uuid,
        function storeRule(err, rule) {
        if (err) {
            return next(err);
        }

        if (hasKey(req.params, 'owner_uuid') &&
            hasKey(rule, 'owner_uuid') &&
            req.params.owner_uuid !== rule.owner_uuid) {
            return next(new mod_err.PermissionDeniedError(
                'owner does not match', [
                mod_err.invalidParam('owner_uuid',
                    'owner_uuid does not match') ]));
        }

        req._rule = rule;
        return next();
    });
}


module.exports = {
    ruleBefore: ruleBefore
};
