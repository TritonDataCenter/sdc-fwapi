/*
 * Copyright 2013 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for firewall data updates
 */

var restify = require('restify');
var util = require('util');



// --- Globals



var UPDATES = {
    'vm.add': validateAdd,
    'vm.update': validateUpdate,
    'vm.delete': validateDel
};



// --- Internal



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
        return next(new restify.MissingParameterError(
            '"type" parameter required'));
    }

    if (!UPDATES.hasOwnProperty(req.params.type)) {
        return next(new restify.MissingParameterError(
            'Unknown update type'));
    }

    try {
        updateParams = UPDATES[req.params.type](req.params);
    } catch (validationErr) {
        return next(validationErr);
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
