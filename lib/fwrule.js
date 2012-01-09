/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Firewall rule model
 */

//var events = require('events');
var assert = require('assert');

var ldap = require('ldapjs');
var restify = require('restify');
var sprintf = require('sprintf').sprintf;
var objCopy = require('./ufds/utils').objCopy;
var parser = require('./fwrule-parser');
var uuid = require('node-uuid');


//---- globals

var log = restify.log;
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var DC = "datacenter";


// Parses a rule written in the firewall DSL
function parseRule(data) {
  var enabled = data.hasOwnProperty('enabled') ? data.enabled : false;

  if (!data.hasOwnProperty('rule')) {
    return { enabled: enabled };
  }

  var parsed = parser.parse(data.rule);
  // Parser should have taken care of all validation by this point
  raw = {
    protocol: parsed.protocol,
    port: parsed.ports,
    action: parsed.action,
    enabled: enabled
  };

  var dirs = ['to', 'from'];
  for (var i in dirs) {
    var dir = dirs[i];
    for (var j in parsed[dir]) {
      var target = parsed[dir][j];
      var targetName = dir + target[0];
      if (!raw.hasOwnProperty(targetName)) {
        raw[targetName] = [];
      }
      raw[targetName].push(target[1]);
    }
  }

  return raw;
}

// Calls callback for all of the firewall target types
function forEachTarget(obj, callback) {
  var dirs = ['from', 'to'];
  var types = ['ip', 'machine', 'subnet', 'tag'];
  for (var i in dirs) {
    var dir = dirs[i];
    var targets = [];
    for (var j in types) {
      var type = types[j];
      var targetName = dir + type;
      if (!obj.hasOwnProperty(targetName)) {
        continue;
      }
      callback(dir, type, targetName, obj[targetName]);
    }
  }
}

// Converts a rule stored in raw format back to the DSL
function ruleText(raw) {
  var targets = {
    from: [],
    to: []
  };

  forEachTarget(raw, function(dir, type, name, arr) {
    for (var i in arr) {
      targets[dir].push(sprintf("%s %s", type, arr[i]));
    }
  });

  return sprintf("FROM %s%s%s TO %s%s%s %s %s PORT %s%s%s",
      targets.from.length > 1 ? '( ' : '',
      targets.from.join(' OR '),
      targets.from.length > 1 ? ' )' : '',
      targets.to.length > 1 ? '( ' : '',
      targets.to.join(' OR '),
      targets.to.length > 1 ? ' )' : '',
      raw.action.toUpperCase(),
      raw.protocol.toLowerCase(),
      raw.port.length > 1 ? '( ' : '',
      raw.port.sort(),
      raw.port.length > 1 ? ' )' : ''
      );
}

// Converts a rule from UFDS to raw format
function ruleFromUFDS(data) {
    var raw = objCopy(data);
    delete raw.dn;

    forEachTarget(data, function(dir, type, name, val) {
      if (val instanceof Array) {
        return;
      }
      raw[name] = [ val ];
    });

    if (!(raw.port instanceof Array)) {
      raw.port = [ raw.port ];
    }

    return raw;
}

//---- Probe model
// Interface is as required by "ufdsmodel.js".
// Presuming routes as follows: '.../monitors/:monitor/probes/:probe'.

/**
 * Create a Probe. `new Probe(app, data)`.
 *
 * @param app
 * @param name {String} The instance name. Can be skipped if `data` includes
 *    "amonprobe" (which a UFDS response does).
 * @param data {Object} The instance data. This can either be the public
 *    representation (augmented with 'name', 'monitor' and 'user'), e.g.:
 *      { name: 'whistlelog',
 *        monitor: 'serverHealth',
 *        user: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
 *        ...
 *    or the raw response from UFDS, e.g.:
 *      { dn: 'amonprobe=whistlelog, amonmonitor=serverHealth, uuid=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa, ou=users, o=smartdc',
 *        amonprobe: 'whistlelog',
 *        ...
 *        objectclass: 'amonprobe' }
 * @throws {restify.RESTError} if the given data is invalid.
 */
function FwRule(data) {
  assert.ok(data, "Data not specified for constructor");

  var raw;
  if (data.objectclass) {  // from UFDS
    assert.equal(data.objectclass, FwRule.objectclass,
        "Incorrect objectclass returned from UFDS");
    this.dn = data.dn;
    raw = ruleFromUFDS(data);

  } else {
    raw = parseRule(data);
    if (data.fwuuid) {
      raw.fwuuid = data.fwuuid;
    } else {
      raw.fwuuid = uuid();
    }
    raw.objectclass = FwRule.objectclass;
    this.dn = FwRule.dn(raw.fwuuid, data.user, data.datacenter);
  }

  this.raw = raw;

  // XXX: validate things like fwuuid here?

  var self = this;
  // XXX: change to id
  this.__defineGetter__('name', function() {
    return self.raw.fwuuid;
  });
  this.__defineGetter__('id', function() {
    return self.raw.fwuuid;
  });
}

FwRule.objectclass = "fwrule";

FwRule.parseDn = function (dn) {
  var parsed = ldap.parseDN(dn);
  return {
    user: parsed.rdns[2].uuid,
    monitor: parsed.rdns[1].amonmonitor,
    name: parsed.rdns[0].amonprobe
  };
}
FwRule.dn = function (fwuuid, user, dc) {
  if (user == DC && dc) {
    return sprintf("fwuuid=%s, ou=fwrules, datacenter=%s, o=smartdc", fwuuid, dc);
  }
  return sprintf(
    "fwuuid=%s, uuid=%s, ou=users, o=smartdc",
    fwuuid, user);
}
FwRule.dnFromRequest = function (req) {
  var fwuuid = req.uriParams.fwuuid;
  FwRule.validateUUID(fwuuid);
  return FwRule.dn(fwuuid, req.uriParams.user, req._datacenter);
};
FwRule.parentDnFromRequest = function (req) {
  var user = req.uriParams.user;
  if (user == DC) {
    var dc = req._datacenter;
    return sprintf("ou=fwrules, datacenter=%s, o=smartdc", dc);
  }
  FwRule.validateUUID(user);
  return sprintf("uuid=%s, ou=users, o=smartdc", user);
};


/**
 * Return the public API view of this Probe's data.
 */
FwRule.prototype.serialize = function serialize() {
  return {
    id: this.raw.fwuuid,
    enabled: this.raw.enabled,
    rule: ruleText(this.raw)
  };
}

FwRule.prototype.changes = function changes() {
  var changes = objCopy(this.raw);
  delete changes['fwuuid'];
  delete changes['objectclass'];
  return changes;
}

/**
 * Get a probe.
 *
 * @param app {App} The Amon Master App.
 * @param user {String} The probe owner user UUID.
 * @param monitor {String} The monitor name.
 * @param name {String} The probe name.
 * @param callback {Function} `function (err, probe)`
Probe.get = function get(app, user, monitor, name, callback) {
  if (! UUID_REGEX.test(user)) {
    throw new restify.InvalidArgumentError(
      sprintf("invalid user UUID: '%s'", user));
  }
  Probe.validateUUID(name);
  Monitor.validateUUID(monitor);
  var dn = Probe.dn(user, monitor, name);
  ufdsmodel.modelGet(app, Probe, dn, log, callback);
}
 */

/**
 * Validate the raw data and optionally massage some fields.
 *
 * @param app {App} The amon-master app.
 * @param raw {Object} The raw data for this object.
 * @returns {Object} The raw data for this object, possibly massaged to
 *    normalize field values.
 * @throws {restify Error} if the raw data is invalid. This is an error
 *    object that can be used to respond with `response.sendError(e)`
 *    for a node-restify response.
 */
FwRule.validate = function validate(app, raw) {
  var requiredFields = {
    // <raw field name>: <exported name>
    "amonprobe": "name",
    "machine": "machine",
    "type": "type",
    "config": "config"
  }
  Object.keys(requiredFields).forEach(function (field) {
    if (!raw[field]) {
      //TODO: This error response is confusing for, e.g., a
      //      "GET /pub/:user/contacts/:contact" where the contact info
      //      in the DB is bogus/insufficient.  Not sure best way to handle
      //      that. Would be a pain to have a separate error hierarchy here
      //      that is translated higher up.
      throw new restify.MissingParameterError(
        sprintf("'%s' is a required parameter", requiredFields[field]));
    }
  });

  //XXX validate the type is an existing probe type
  //  var plugin = req._config.plugins[type];
  //  if (!plugin) {
  //var e = restify.newError({
  //  httpCode: HttpCodes.Conflict,
  //  restCode: RestCodes.InvalidArgument,
  //  message: sprintf('probe type is invalid: %s', msg)
  //});
  //...
  //    return next();
  //  }

  //XXX validate data for that probe type
  //  try {
  //    plugin.validateConfig(raw.config);
  //  } catch (e) {
  //var e = restify.newError({
  //  httpCode: HttpCodes.Conflict,
  //  restCode: RestCodes.InvalidArgument,
  //  message: sprintf('config is invalid: %s', msg)
  //});
  //...
  //    return next();
  //  }

  return raw;
}

/**
 * Validate the given name.
 *
 * @param name {String} The object name.
 * @throws {restify Error} if the name is invalid.
 */
FwRule.validateUUID = function validateUUID(uuid) {
  if (!UUID_REGEX.test(uuid)) {
    throw new restify.InvalidArgumentError(
      sprintf("user uuid is invalid: '%s'", uuid));
  }
}

module.exports = {
  FwRule: FwRule,
  parseRule: parseRule,
  ruleText: ruleText
};
