/*
 * Copyright 2011 Joyent, Inc.  All rights reserved.
 *
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
 *     Foo.prototype.serialize = function serialize() {...}  # output for API responses
 *     <instance>.raw     # the raw UFDS data
 *     <instance>.dn      s# the UFDS DN for this object
 */

var debug = console.warn;
var assert = require('assert');
var ldap = require('ldapjs');
var restify = require('restify');
var RestCodes = restify.RestCodes;
var Cache = require('./cache').Cache;
var objCopy = require('./utils').objCopy;



//---- generic list/create/get/delete model helpers

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
  // Check cache. "cached" is `{err: <error>, items: <items>}`.
  var cacheScope = Model.name + "List";
  var cacheKey = parentDn;
  var cached = app.cacheGet(cacheScope, cacheKey);
  if (cached) {
    if (cached.err)
      return callback(cached.err);
    return callback(null, cached.items);
  }

  function cacheAndCallback(err, items) {
    app.cacheSet(cacheScope, cacheKey, {err: err, items: items});
    callback(err, items);
  }

  var opts = {
    filter: '(objectclass=' + Model.objectclass + ')',
    scope: 'sub'
  };

  if (filter) {
    opts.filter = '(&' + opts.filter + filter + ')';
  }

  app.ufds.search(parentDn, opts, function(err, result) {
    if (err) return cacheAndCallback(err);
    var items = [];
    result.on('searchEntry', function(entry) {
      try {
        items.push(new Model(entry.object));
      } catch(err2) {
        if (err2 instanceof restify.RESTError) {
          log.warn("Ignoring invalid %s (dn='%s'): %s", Model.name,
            entry.object.dn, err2)
        } else {
          log.error("Unknown error with %s entry: %s %o\n%s", Model.name,
            err2, entry.object, err2.stack)
        }
      }
    });
    result.on('error', function(err) {
      log.error("Error searching UFDS: %s (opts: %s)",
          err, JSON.stringify(opts));
      return callback(new restify.InternalError());
    });
    result.on('end', function(result) {
      if (result.status !== 0) {
        log.error("Non-zero status from UFDS search: %s (opts: %s)",
          result, JSON.stringify(opts));
        return callback(new restify.InternalError());
      }
      log.trace('%s items: %o', Model.name, items);
      return cacheAndCallback(null, items);
    });
  });
}


function modelPost(app, Model, data, log, callback) {
  var item;
  try {
    item = new Model(data);
  } catch (e) {
    log.error("<%s> constructor error: %s", Model.name, e);
    return callback(e);
  }

  var dn = item.dn;
  app.ufds.add(dn, item.raw, function(err) {
    if (err) {
      log.error("Error saving (dn=%s): %s (raw: %s)",
        dn, err, JSON.stringify(item.raw));
      return callback(new restify.InternalError());
    } else {
      if (log.trace()) {
        log.trace('<%s> create: item=%o', Model.name, item.serialize());
      }
      app.cacheInvalidatePut(Model.name, item);
      return callback(null, item);
    }
  });
}


function modelPut(app, Model, dn, data, log, callback) {
  var item;
  try {
    item = new Model(data);
  } catch (e) {
    return callback(e);
  }

  var change = {
    operation: "replace",
    modification: item.raw
  };

  app.ufds.modify(dn, change, function(err) {
    if (err) {
      log.error("Error saving (dn=%s): %s", err);
      return callback(new restify.InternalError());
    } else {
      if (log.trace()) {
        log.trace('<%s> update: change=%o', Model.name, change);
      }

      modelGet(app, Model, dn, log, true, function(err, item) {
        if (err) {
          return callback(err);
        }
        app.cacheInvalidatePut(Model.name, item);
        var cacheScope = Model.name + "Get";
        app.cacheSet(cacheScope, dn, {err: err, item: item});

        return callback(null, item);
      });
    }
  });
}


/**
 * Model.get
 *
 * ...
 * @param skipCache {Boolean} Optional. Default false. Set to true to skip
 *    looking up in the cache.
 * @param callback {Function} `function (err, item)` where err is a
 *    restify.RESTError instance on error.
 */
function modelGet(app, Model, dn, log, skipCache, callback) {
  if (callback === undefined) {
    callback = skipCache
    skipCache = false;
  }

  // Check cache. "cached" is `{err: <error>, item: <item>}`.
  if (!skipCache) {
    var cacheScope = Model.name + "Get";
    var cached = app.cacheGet(cacheScope, dn);
    if (cached) {
      if (cached.err)
        return callback(cached.err);
      return callback(null, cached.item);
    }
  }

  function cacheAndCallback(err, item) {
    if (!skipCache) {
      app.cacheSet(cacheScope, dn, {err: err, item: item});
    }
    callback(err, item);
  }

  var opts = {scope: 'base'};
  app.ufds.search(dn, opts, function(err, result) {
    if (err) return cacheAndCallback(err);

    var item = null;
    result.on('searchEntry', function(entry) {
      // Should only one entry with this DN.
      assert.ok(item === null, "more than one item with dn='"+dn+"': "+item);
      try {
        item = new Model(entry.object);
      } catch(err2) {
        if (err2 instanceof restify.RESTError) {
          log.warn("Ignoring invalid %s (dn='%s'): %s", Model.name,
            entry.object.dn, err2)
        } else {
          log.error("Unknown error with %s entry: %s %o\n%s", Model.name,
            err2, entry.object, err2.stack)
        }
      }
    });

    result.on('error', function(err) {
      if (err instanceof ldap.NoSuchObjectError) {
        return cacheAndCallback(new restify.ResourceNotFoundError());
      } else {
        log.error("Error searching UFDS: %s (opts: %s)",
            err, JSON.stringify(opts));
        return callback(new restify.InternalError());
      }
    });

    result.on('end', function(result) {
      if (result.status !== 0) {
        log.error("Non-zero status from UFDS search: %s (opts: %s)",
          result, JSON.stringify(opts));
        return callback(new restify.InternalError());
      }
      if (item) {
        return cacheAndCallback(null, item);
      } else {
        return cacheAndCallback(new restify.ResourceNotFoundError());
      }
    });
  });
}


function modelDelete(app, Model, dn, log, callback) {
  //TODO: could validate the 'dn'

  // We need to first get the item (we'll need it for proper cache
  // invalidation).
  modelGet(app, Model, dn, log, true, function(err, item) {
    if (err) {
      return callback(err);
    }
    app.ufds.del(dn, function(err) {
      if (err) {
        if (err instanceof ldap.NoSuchObjectError) {
          return callback(new restify.ResourceNotFoundError());
        } else {
          log.error("Error deleting '%s' from UFDS: %s", dn, err);
          return callback(new restify.InternalError());
        }
      } else {
        app.cacheInvalidateDelete(Model.name, item);
        return callback();
      }
    });
  });
}



//---- request/response wrappers around the above helpers

function requestList(req, res, next, Model) {
  req._log.trace('<%s> list entered: params=%o, uriParams=%o',
    Model.name, req.params, req.uriParams);
  var parentDn = Model.parentDnFromRequest(req);
  modelList(req._app, Model, parentDn, req._log, function (err, items) {
    if (err) {
      res.sendError(err);
    } else {
      var serialized = [];
      for (var i in items) {
        serialized.push(items[i].serialize());
      }
      res.send(200, serialized);
    }
    return next();
  });
}


function requestListFiltered(req, res, next, Model, constructFilterCallback) {
  req._log.trace('<%s> list filtered entered: params=%o, uriParams=%o',
    Model.name, req.params, req.uriParams);
  var parentDn = Model.parentDnFromRequest(req);
  var filter = constructFilterCallback(req);
  modelListFiltered(req._app, Model, parentDn, filter, req._log, function (err, items) {
    if (err) {
      res.sendError(err);
    } else {
      var serialized = [];
      for (var i in items) {
        serialized.push(items[i].serialize());
      }
      res.send(200, serialized);
    }
    return next();
  });
}


function requestPost(req, res, next, Model, populateCallback) {
  req._log.trace('<%s> create entered: params=%o, uriParams=%o',
    Model.name, req.params, req.uriParams);

  // Note this means that the *route variable names* need to match the
  // expected `data` key names in the models (e.g. `monitors.Monitor`).
  var data = objCopy(req.params);
  Object.keys(req.uriParams).forEach(function (k) {
    data[k] = req.uriParams[k];
  });

  if (populateCallback) {
    populateCallback(req, data);
  }

  modelPost(req._app, Model, data, req._log, function(err, item) {
    if (err) {
      res.sendError(err);
    } else {
      res.send(200, item.serialize());
    }
    return next();
  });
}

function requestPut(req, res, next, Model, populateCallback) {
  req._log.trace('<%s> update entered: params=%o, uriParams=%o',
    Model.name, req.params, req.uriParams);

  // Note this means that the *route variable names* need to match the
  // expected `data` key names in the models (e.g. `monitors.Monitor`).
  var data = objCopy(req.params);
  Object.keys(req.uriParams).forEach(function (k) {
    data[k] = req.uriParams[k];
  });

  if (populateCallback) {
    populateCallback(req, data);
  }
  var dn = Model.dnFromRequest(req);

  modelPut(req._app, Model, dn, data, req._log, function(err, item) {
    if (err) {
      res.sendError(err);
    } else {
      res.send(200, item.serialize());
    }
    return next();
  });
}

function requestGet(req, res, next, Model) {
  req._log.trace('<%s> get entered: params=%o, uriParams=%o',
    Model.name, req.params, req.uriParams);
  var dn;
  try {
    dn = Model.dnFromRequest(req);
  } catch (err) {
    return res.sendError(err);
  }
  modelGet(req._app, Model, dn, req._log, function (err, item) {
    if (err) {
      // Don't log "ERROR" for a 404.
      res.sendError(err, err instanceof restify.ResourceNotFoundError);
    } else {
      res.send(200, item.serialize());
    }
    return next();
  });
}


function requestDelete(req, res, next, Model) {
  req._log.trace('<%s> delete entered: params=%o, uriParams=%o',
    Model.name, req.params, req.uriParams);
  var dn = Model.dnFromRequest(req);
  modelDelete(req._app, Model, dn, req._log, function(err) {
    if (err) {
      res.sendError(err);
    } else {
      res.send(204);
    }
    return next();
  });
}



//---- exports

module.exports = {
  modelList: modelList,
  modelListFiltered: modelListFiltered,
  modelPost: modelPost,
  modelPut: modelPut,
  modelGet: modelGet,
  modelDelete: modelDelete,
  requestList: requestList,
  requestListFiltered: requestListFiltered,
  requestPost: requestPost,
  requestPut: requestPut,
  requestGet: requestGet,
  requestDelete: requestDelete
};
