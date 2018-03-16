/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Restify handlers for firewall data updates
 */

'use strict';

var restify = require('restify');
var mod_err = require('../errors');
var validate = require('restify-warden');



// --- Globals



var UPDATE_TYPES = [
    'sync',
    'vm.add',
    'vm.update',
    'vm.delete'
];

var UPDATE_SCHEMA = {
    required: {
        type: validateUpdateTypes
    },
    optional: {
        uuid: validate.UUID,
        req_id: validate.UUID,
        owner_uuid: validate.UUID,
        server_uuid: validate.UUID
    }
};



// --- Internal


function validateUpdateTypes(_, name, type, callback) {
    if (UPDATE_TYPES.indexOf(type) === -1) {
        callback(mod_err.invalidParamErr(name, 'Invalid update type'));
        return;
    }
    callback();
}

// --- Restify handlers



/**
 * POST /updates
 */
function createUpdate(req, res, next) {

    if (!req.params.type) {
        next(new restify.MissingParameterError(
            '"type" parameter required'));
        return;
    }

    validate.params(UPDATE_SCHEMA, null, req.params,
        function (err, _validated) {
        if (err) {
            next(err);
            return;
        }

        req._update.queue(req.params.type, req.params, function (err2, res2) {
            if (err2) {
                next(err2);
                return;
            }

            res.send(202, { update_uuid: res2.uuid });
            next();
        });
    });
}



// --- Exports



/**
 * Registers endpoints with a restify server
 */
function register(server, before) {
    server.post({ path: '/updates', name: 'createUpdate' },
            before, createUpdate);
}



module.exports = {
    register: register
};
