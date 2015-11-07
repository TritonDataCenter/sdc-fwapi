/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
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
 *     <instance>.raw     = function raw() {...}  # the raw UFDS data
 *     <instance>.dn      s# the UFDS DN for this object
 */

var clone = require('clone');
var mod_err = require('../errors');
var restify = require('restify');
var RestCodes = restify.RestCodes;



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
        return callback(e);
    }

    var dn = item.dn;
    app.ufds.add(dn, item.raw(), function (err) {
        if (err) {
            log.error({ err: err, raw: item.raw() },
                'modelPost: Error saving dn=%s', dn);

            // XXX: should change sdc-clients to use WError instead
            if (err.name == 'InvalidArgumentError' &&
                err.message.indexOf('already exists') !== -1) {
                err = new mod_err.createExistsErr(Model.name, item.idName);
            }

            return callback(err);
        }

        if (log.trace()) {
            log.trace(item.serialize(), 'modelPost: <%s> create', Model.name);
        }
        return callback(null, item);
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
        modification: item.raw()
    };

    return modify(app, Model, dn, change, log, callback);
}


function modify(app, Model, dn, change, log, callback) {
    app.ufds.modify(dn, change, function (err) {
        if (err) {
            log.error({ err: err, change: change },
                'modify: Error updating <%s> (dn=%s)', Model.name, dn);
            return callback(err);
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
            if (err.body && err.body.code === 'ResourceNotFound') {
                return callback(notFoundErr(Model, dn));
            }

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


function modelDelete(app, Model, dn, log, callback) {
    // TODO: could validate the 'dn'
    app.ufds.del(dn, function (err) {
        if (err) {
            if (err.body && err.body.code === 'ResourceNotFound') {
                return callback(notFoundErr(Model, dn));
            }
            log.error(err, 'Error deleting "%s" from UFDS: %s', dn, err.code);
        }

        return callback(err);
    });
}



// --- request/response wrappers around the above helpers



function requestList(req, res, next, Model) {
    req.log.trace('<%s> list entered: params=%o, uriParams=%o',
        Model.name, req.params, req.uriParams);

    var parentDn;
    try {
        parentDn = Model.parentDnFromRequest(req);
    } catch (err) {
        req.log.error({ err: err, params: req.params},
                'requestList: <%s>: error getting parent DN', Model.name);
        return next(err);
    }

    modelList(req._app, Model, parentDn, req.log, function (err, items) {
        if (err) {
            return next(err);
        }

        var serialized = [];
        for (var i in items) {
            serialized.push(items[i].serialize());
        }
        res.send(200, serialized);
        return next();
    });
}


function requestListFiltered(opts, next) {
    var req = opts.req;
    var res = opts.res;
    var Model = opts.model;
    var filter = opts.filter;
    var serializeOpts = opts.serializeOpts;

    req.log.trace({
        filter: filter,
        params: req.params,
        uriParams: req.uriParams
    }, '<%s> list filtered entered', Model.name);

    var parentDn;
    try {
        parentDn = Model.parentDnFromRequest(req);
    } catch (err) {
        req.log.error({ err: err, params: req.params},
            'requestListFiltered: <%s>: error getting parent DN', Model.name);
        return next(err);
    }

    modelListFiltered(req._app, Model, parentDn, filter, req.log,
        function (err, items) {
        if (err) {
            return next(err);
        }

        res.send(200, items.map(function (it) {
            if (serializeOpts) {
                return it.serialize(serializeOpts);
            }

            return it.serialize();
        }));

        return next();
    });
}


function requestPost(req, res, next, Model, populateCallback) {
    req.log.trace('<%s> create entered: params=%o, uriParams=%o',
        Model.name, req.params, req.uriParams);

    // Note this means that the *route variable names* need to match the
    // expected `data` key names in the models (e.g. `monitors.Monitor`).
    var data = clone(req.params);
    if (populateCallback) {
        populateCallback(req, data);
    }

    modelPost(req._app, Model, data, req.log, function (err, item) {
        if (err) {
            return next(err);
        }

        res.send(200, item.serialize());
        return next();
    });
}


function requestPut(req, res, next, Model, populateCallback) {
    req.log.trace(req.params, 'requestPut: <%s> update entered', Model.name);

    // Note this means that the *route variable names* need to match the
    // expected `data` key names in the models (e.g. `monitors.Monitor`).
    var data = clone(req.params);
    if (populateCallback) {
        populateCallback(req, data);
    }

    var dn;
    try {
        dn = Model.dnFromRequest(req);
    } catch (err) {
        return next(err);
    }

    modelPut(req._app, Model, dn, data, req.log, function (err, item) {
        if (err) {
            return next(err);
        }

        res.send(200, item.serialize());
        return next();
    });
}


function requestGet(req, res, next, Model) {
    req.log.trace(req.params, '<%s> get entered', Model.name);

    var dn;
    try {
        dn = Model.dnFromRequest(req);
    } catch (err) {
        return next(err);
    }

    modelGet(req._app, Model, dn, req.log, function (err, item) {
        if (err) {
            return next(err);
        }

        res.send(200, item.serialize());
        return next();
    });
}


function requestDelete(req, res, next, Model) {
    req.log.trace('<%s> delete entered: params=%o, uriParams=%o',
        Model.name, req.params, req.uriParams);

    var dn = Model.dnFromRequest(req);
    modelDelete(req._app, Model, dn, req.log, function (err) {
        if (err) {
            return next(err);
        }

        res.send(204);
        return next();
    });
}



module.exports = {
    modelDelete: modelDelete,
    modelGet: modelGet,
    modelList: modelList,
    modelListFiltered: modelListFiltered,
    modelPost: modelPost,
    modelPut: modelPut,
    modify: modify,
    requestDelete: requestDelete,
    requestGet: requestGet,
    requestList: requestList,
    requestListFiltered: requestListFiltered,
    requestPost: requestPost,
    requestPut: requestPut
};
