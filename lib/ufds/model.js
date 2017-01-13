/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Helpers for modeling data in UFDS (i.e. handling list/get/create/delete).
 *
 * In all the functions below `Model` is expected to be a model constructor
 * function with the following interface (see comments in the model
 * implementations for details):
 *
 *     function Foo(name, data) {...}
 *     Foo.objectclass = "amonfoo";
 *     Foo.dnFromRequest = function (req) {...}
 *     Foo.parentDnFromRequest = function (req) {...}
 *     Foo.prototype.serialize = function serialize() {...}  # output for API
 *                                                             responses
 *     <instance>.rawUFDS = function raw() {...}  # the raw UFDS data
 *     <instance>.dn      s# the UFDS DN for this object
 */

'use strict';

var mod_err = require('../errors');
var restify = require('restify');



// --- Helpers


/*
 * Returns a nicely formatted error, rather than the generic UFDS not found
 * error
 */
function notFoundErr(Model, dn) {
    var err = new restify.ResourceNotFoundError('%s not found', Model.name);
    // Add dn so that it will get logged
    err.dn = dn;

    return err;
}



// --- Exports



/**
 * Model.list
 *
 * ...
 * @param callback {Function} `function (err, items)` where err is a
 *    restify.RESTError instance on error.
 */
function modelList(app, Model, parentDn, log, callback) {
    return modelListFiltered(app, Model, parentDn, null, log, callback);
}


/**
 * Model.listwithfilter
 *
 * ...
 * @param callback {Function} `function (err, items)` where err is a
 *    restify.RESTError instance on error.
 */
function modelListFiltered(app, Model, parentDn, filter, log, callback) {
    var opts = {
        filter: '(objectclass=' + Model.objectclass + ')',
        scope: 'sub'
    };

    if (filter) {
        opts.filter = '(&' + opts.filter + filter + ')';
    }

    log.debug(opts, 'modelListFiltered: <%s>: searching %s',
        Model.name, parentDn);
    app.ufds.search(parentDn, opts, function (err, result) {
        if (err) {
            return callback(err);
        }

        var items = [];
        result.forEach(function (entry) {
            log.trace(entry, 'modelListFiltered: <%s> item', Model.name);
            try {
                items.push(new Model(entry, app));
            } catch (err2) {
                if (err2 instanceof restify.RestError) {
                    log.warn(err2, 'Ignoring invalid <%s> (dn="%s")',
                        Model.name, entry.object.dn);
                } else {
                    log.error({ err: err2, obj: entry },
                        'Unknown error with <%s> entry', Model.name);
                }
            }
        });

        log.debug('modelListFiltered: <%s>: found %d items under %s',
            Model.name, items.length, parentDn);
        return callback(null, items);
    });
}


function modelPost(app, Model, data, log, callback) {
    var item;
    try {
        item = new Model(data, app);
    } catch (e) {
        log.error(e, 'modelPost: <%s> constructor error', Model.name);
        callback(e);
        return;
    }

    var dn = item.dn;
    app.ufds.add(dn, item.rawUFDS(), function (err) {
        if (err) {
            log.error({ err: err, raw: item.rawUFDS() },
                'modelPost: Error saving dn=%s', dn);

            // XXX: should change sdc-clients to use WError instead
            if (err.name === 'InvalidArgumentError' &&
                err.message.indexOf('already exists') !== -1) {
                err = mod_err.createExistsErr(Model.name, item.idName);
            }

            callback(err);
            return;
        }

        if (log.trace()) {
            log.trace(item.serialize(), 'modelPost: <%s> create', Model.name);
        }

        callback(null, new Model(item.rawUFDS(), app));
    });
}


function modelPut(app, Model, dn, data, log, callback) {
    var item;

    if (data instanceof Model) {
        item = data;
    } else {
        try {
            item = new Model(data, app);
        } catch (e) {
            return callback(e);
        }
    }

    var change = {
        operation: 'replace',
        modification: item.rawUFDS()
    };

    return modify(app, Model, dn, change, log, callback);
}


function modify(app, Model, dn, change, log, callback) {
    app.ufds.modify(dn, change, function (err) {
        if (err) {
            log.error({ err: err, change: change },
                'modify: Error updating <%s> (dn=%s)', Model.name, dn);
            callback(err);
            return;
        }

        if (log.debug()) {
            log.debug(change, 'modify: <%s> update', Model.name);
        }

        modelGet(app, Model, dn, log, function (err2, updated) {
            if (err2) {
                return callback(err2);
            }

            return callback(null, updated);
        });
    });
}


/**
 * Model.get
 *
 * ...
 * @param callback {Function} `function (err, item)` where err is a
 *    restify.RESTError instance on error.
 */
function modelGet(app, Model, dn, log, callback) {
    var opts = {scope: 'base'};

    app.ufds.search(dn, opts, function (err, results) {
        if (err) {
            return callback(err);
        }

        if (!results || results.length === 0) {
            return callback(notFoundErr(Model, dn));
        }

        if (results.length !== 1) {
            log.warn(results, 'modelGet: more than one <%s> with dn=%s found',
                Model.name, dn);
        }

        log.debug(results[0], 'modelGet: Got <%s>, dn=%s ', Model.name, dn);
        var item;
        try {
            item = new Model(results[0], app);
        } catch (err2) {
            log.error({ err: err2, obj: results[0] },
                'Invalid <%s> (dn="%s")', Model.name, dn);

            return callback(notFoundErr(Model, dn));
        }

        return callback(null, item);
    });
}


function modelDelete(app, _Model, dn, _log, callback) {
    // TODO: could validate the 'dn'
    app.ufds.del(dn, callback);
}


module.exports = {
    modelDelete: modelDelete,
    modelGet: modelGet,
    modelList: modelList,
    modelListFiltered: modelListFiltered,
    modelPost: modelPost,
    modelPut: modelPut,
    modify: modify
};
