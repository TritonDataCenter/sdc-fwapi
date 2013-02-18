/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Firewall rule model
 */

var assert = require('assert-plus');
var clone = require('clone');
var mod_rule = require('fwrule');
var restify = require('restify');
var util = require('util');
var util_ip = require('./util/ip');



//---- Globals



var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;



//--- Internal helpers



/**
 * Validate the given UUID
 *
 * @param UUID {String} The UUID
 * @throws {restify Error} if the UUID invalid
 */
function validateUUID(uuid) {
  // XXX: replace this with validator from NAPI
  if (!UUID_REGEX.test(uuid)) {
    throw new restify.InvalidArgumentError(
      util.format('UUID "%s" is invalid', uuid));
  }
}


/**
 * Calls callback for all of the firewall target types
 */
function forEachTarget(obj, callback) {
  for (var i in mod_rule.DIRECTIONS) {
    var dir = mod_rule.DIRECTIONS[i];
    var targets = [];
    for (var j in mod_rule.TARGET_TYPES) {
      var type = mod_rule.TARGET_TYPES[j];
      var targetName = dir + type;
      if (!obj.hasOwnProperty(targetName)) {
        continue;
      }
      callback(dir, type, targetName, obj[targetName]);
    }
  }
}


/**
 * Converts a rule from UFDS to raw format
 */
function ruleFromUFDS(raw) {
  var data = {
    objectclass: raw.objectclass,
    parsed: {
      action: raw.action,
      enabled: raw.enabled === 'true',
      from: [],
      ports: typeof (raw.ports) === 'object' ? raw.ports : [ raw.ports ],
      protocol: raw.protocol,
      to: []
    },
    uuid: raw.uuid,
    version: raw.version
  };

  if (typeof (raw.enabled) === 'boolean') {
    data.enabled = raw.enabled;
  }

  mod_rule.DIRECTIONS.forEach(function (dir) {
    mod_rule.TARGET_TYPES.forEach(function (type) {
      var key = dir + type;
      if (!raw.hasOwnProperty(key)) {
        return;
      }
      var targets = typeof (raw[key]) === 'object' ? raw[key] : [ raw[key] ];

      targets.forEach(function (t) {
        if (type === 'ip') {
          t = util_ip.ntoa(t);
        }

        if (type === 'subnet') {
          var split = t.split('/');
          t = util_ip.ntoa(split[0]) + '/' + split[1];
        }
        data.parsed[dir].push([type, t]);
      });
    });
  });

  return data;
}



//---- Rule model: interface is as required by 'ufdsmodel.js'



/**
 * Create a Rule. `new Rule(data)`
 *
 * @param data {Object} data for instantiating the firewall rule. This can
 * either be:
 * - the public representation
 * - the raw response from UFDS (determined to be this if data.objectclass is
 *   present)
 * @throws {restify.RESTError} if the given data is invalid.
 */
function Rule(data) {
  assert.object(data, 'fwrule data');
  var raw = data;

  // Data is from UFDS:
  if (data.objectclass) {
    assert.equal(data.objectclass, Rule.objectclass,
        'Incorrect objectclass returned from UFDS');
    raw = ruleFromUFDS(data);
  }

  mod_rule.FwRule.call(this, raw);
  this.dn = Rule.dn(this.uuid);
}

util.inherits(Rule, mod_rule.FwRule);

Rule.objectclass = 'fwrule';


Rule.prototype.raw = function () {
  var self = this;
  var raw = {
    action: this.action,
    enabled: this.enabled,
    objectclass: Rule.objectclass,
    ports: this.ports,
    protocol: this.protocol,
    uuid: this.uuid,
    version: this.version
  };

  if (this.hasOwnProperty('owner_uuid')) {
    raw.owner = this.owner_uuid;
  }

  mod_rule.DIRECTIONS.forEach(function (dir) {
    mod_rule.TARGET_TYPES.forEach(function (type) {
      var name = type + 's';

      if (self[dir].hasOwnProperty(name) && self[dir][name].length !== 0) {
        if (type === 'ip') {
          raw[dir + type] = self[dir][name].map(function (ip) {
            return util_ip.aton(ip);
          });
        } else if (type === 'subnet') {
          raw[dir + type] = self[dir][name].map(function (subnet) {
            var split = subnet.split('/');
            return util_ip.aton(split[0]) + '/' + split[1];
          });
        } else {
          raw[dir + type] = self[dir][name];
        }
      }
    });
  });

  return raw;
};



// --- DN helper functions



/**
 * Returns the DN for the rule
 */
Rule.dn = function (uuid) {
  return util.format('uuid=%s, ou=fwrules, o=smartdc', uuid);
};


/**
 * Returns the parent DN for the rule
 */
Rule.parentDn = function () {
  return 'ou=fwrules, o=smartdc';
};


/**
 * Returns the DN based on the request
 */
Rule.dnFromRequest = function (req) {
  var uuid = req.params.uuid;
  validateUUID(uuid);
  return Rule.dn(uuid);
};


/**
 * Returns the parent DN based on the request
 */
Rule.parentDnFromRequest = function (req) {
  return Rule.parentDn();
};



// --- Exports



/**
 * Creates a new Rule object
 */
function createRule(data) {
  return new Rule(data);
}



module.exports = {
  ACTIONS: mod_rule.ACTIONS,
  create: createRule,
  DIRECTIONS: mod_rule.DIRECTIONS,
  objectclass: Rule.objectclass,
  parentDn: Rule.parentDn,
  PROTOCOLS: mod_rule.PROTOCOLS,
  Rule: Rule,
  TARGET_TYPES: mod_rule.TARGET_TYPES
};
