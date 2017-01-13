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

var hasKey = require('jsprim').hasKey;
var restify = require('restify');



// --- Globals



var UPDATES = {
    'sync': validateSync,
    'vm.add': validateAdd,
    'vm.update': validateUpdate,
    'vm.delete': validateDel
};



// --- Internal



function validateSync(params) {
    return {
        type: params.type,
        req_id: params.req_id
    };
}

function validateAdd(params) {
    return params;
}


function validateDel(params) {
    return params;
}


function validateUpdate(params) {
    return params;
}



// --- Restify handlers



/**
 * POST /updates
 */
function createUpdate(req, res, next) {
    var updateParams;

    if (!req.params.type) {
        next(new restify.MissingParameterError(
            '"type" parameter required'));
        return;
    }

    if (!hasKey(UPDATES, req.params.type)) {
        next(new restify.MissingParameterError(
            'Unknown update type'));
        return;
    }

    try {
        updateParams = UPDATES[req.params.type](req.params);
    } catch (validationErr) {
        next(validationErr);
        return;
    }

    req._update.queue(req.params.type, updateParams, function (err, res2) {
        if (err) {
            return next(err);
        }

        res.send(202, { update_uuid: res2.uuid });
        return next();
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
