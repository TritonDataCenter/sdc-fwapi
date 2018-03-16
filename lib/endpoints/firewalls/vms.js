/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Restify handlers for listing rules applied to vms
 */

'use strict';

var mod_persist = require('../../persist');
var validate = require('restify-warden');



// --- Internal helpers


var VMS_SCHEMA = {
    strict: true,
    required: {
        uuid: validate.UUID
    },
    optional: {
        owner_uuid: validate.UUID
    }
};



// --- Restify handlers



/**
 * GET /firewalls/vms/:uuid
 */
function getVMrules(req, res, next) {
    validate.params(VMS_SCHEMA, null, req.params, function (err, validated) {
        if (err) {
            next(err);
            return;
        }

        req._vmapi.getVm(validated, {
            headers: {'request-id': req.getId()}
        }, function (err2, vm) {
            if (err2) {
                next(err2);
                return;
            }

            var filter = {
                owner_uuid: vm.owner_uuid,
                tags: vm.tags,
                vms: [ vm.uuid ]
            };

            req.log.debug(filter, 'filtering UFDS rules');
            mod_persist.vmRules(req._app, req.log, filter,
                function (err3, rules) {
                if (err3) {
                    return next(err3);
                }

                res.send(200, rules.map(function (r) {
                    return r.serialize();
                }));

                return next();
            });
        });
    });
}



// --- Exports



/**
 * Registers endpoints with a restify server
 */
function register(server, before) {
    server.get({ path: '/firewalls/vms/:uuid', name: 'getVMrules' },
        before, getVMrules);
}



module.exports = {
    register: register
};
