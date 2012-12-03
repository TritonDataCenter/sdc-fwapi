/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Firewall rule model
 */

var assert = require('assert-plus');
var clone = require('clone');
var parser = require('./fwrule-parser');
var restify = require('restify');
var uuid = require('node-uuid');
var util = require('util');



//---- Globals



var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var DC = "datacenter";
var DIRECTIONS = ['to', 'from'];
var TARGET_TYPES = ['wildcard', 'ip', 'machine', 'subnet', 'tag'];
var PROTOCOLS = ['tcp', 'udp', 'icmp'];
var ACTIONS = ['allow', 'block'];



//--- Internal helpers



/**
 * Calls callback for all of the firewall target types
 */
function forEachTarget(obj, callback) {
  for (var i in DIRECTIONS) {
    var dir = DIRECTIONS[i];
    var targets = [];
    for (var j in TARGET_TYPES) {
      var type = TARGET_TYPES[j];
      var targetName = dir + type;
      if (!obj.hasOwnProperty(targetName)) {
        continue;
      }
      callback(dir, type, targetName, obj[targetName]);
    }
  }
}


/**
 * Converts a rule stored in raw format back to the DSL
 */
function ruleText(raw) {
  var targets = {
    from: [],
    to: []
  };

  forEachTarget(raw, function(dir, type, name, arr) {
    for (var i in arr) {
      var txt = util.format("%s %s", type, arr[i]);
      if (type == "wildcard") {
        txt = arr[i];
      }
      targets[dir].push(txt);
    }
  });

  return util.format("FROM %s%s%s TO %s%s%s %s %s %sPORT %s%s",
      targets.from.length > 1 ? '( ' : '',
      targets.from.join(' OR '),
      targets.from.length > 1 ? ' )' : '',
      targets.to.length > 1 ? '( ' : '',
      targets.to.join(' OR '),
      targets.to.length > 1 ? ' )' : '',
      raw.action.toUpperCase(),
      raw.protocol.toLowerCase(),
      raw.port.length > 1 ? '( ' : '',
      raw.port.sort().join(' AND PORT '),
      raw.port.length > 1 ? ' )' : ''
      );
}


/**
 * Converts a rule from UFDS to raw format
 */
function ruleFromUFDS(data) {
  var raw = clone(data);

  forEachTarget(data, function(dir, type, name, val) {
    if (val instanceof Array) {
      return;
    }
    raw[name] = [ val ];
  });

  if (!(raw.port instanceof Array)) {
    raw.port = [ raw.port ];
  }

  var splitDN = raw.dn.split(', ');
  for (var i in splitDN) {
    var kv = splitDN[i].split('=');
    if (kv[0] == 'uuid') {
      raw.user = kv[1];
      break;
    }
  }
  delete raw.dn;

  return raw;
}



//---- FwRule model: interface is as required by 'ufdsmodel.js'



/**
 * Create a FwRule. `new FwRule(data)`
 *
 * @param data {Object} data for instantiating the firewall rule. This can
 * either be:
 * - the public representation
 * - the raw response from UFDS (determined to be this if data.objectclass is
 *   present)
 * @throws {restify.RESTError} if the given data is invalid.
 */
function FwRule(data) {
  assert.object(data, 'fwrule data');

  var raw;
  if (data.objectclass) {  // from UFDS
    assert.equal(data.objectclass, FwRule.objectclass,
        'Incorrect objectclass returned from UFDS');
    this.dn = data.dn;
    raw = ruleFromUFDS(data);

  } else {
    raw = parseRule(data);
    if (data.fwrule) {
      raw.fwrule = data.fwrule;
    } else {
      raw.fwrule = uuid.v4();
    }
    raw.objectclass = FwRule.objectclass;
    this.dn = FwRule.dn(raw.fwrule, data.owner_uuid, data.datacenter);
  }

  this.raw = raw;

  // XXX: validate things like fwrule here?

  var self = this;
  // XXX: change to id
  this.__defineGetter__('name', function() {
    return self.raw.fwrule;
  });
  this.__defineGetter__('id', function() {
    return self.raw.fwrule;
  });
  this.__defineGetter__('rule', function() {
    return ruleText(self.raw);
  });
}


FwRule.objectclass = "fwrule";


/**
 * Return the public API view of the rule
 */
FwRule.prototype.serialize = function serialize() {
  var ser = {
    uuid: this.raw.fwrule,
    enabled: this.raw.enabled,
    rule: ruleText(this.raw),
  };

  if (this.raw.user) {
    ser.owner_uuid = this.raw.user;
  }

  return ser;
};



// --- Direction helper methods



/**
 * Return whether an element is in the 'from' or 'to' side of the rule
 * (or null if it's in neither)
 */
FwRule.prototype.elementDirection = function(type, element) {
  var self = this;

  for (var d in DIRECTIONS) {
    var prop = DIRECTIONS[d] + type;
    if (!this.raw.hasOwnProperty(prop)) {
      continue;
    }

    if (element instanceof Array) {
      for(var el in element) {
        if (self.raw[prop].indexOf(element[el]) != -1) {
          return DIRECTIONS[d];
        }
      }
    } else {
      if (this.raw[prop].indexOf(element) != -1) {
        return DIRECTIONS[d];
      }
    }
  }
  return null;
};


/**
 * Returns the direction (from, to) that a target (machine, rule, etc) is on
 */
FwRule.prototype.direction = function (filter) {
  var direction = null;

  if (filter.hasOwnProperty('machine')) {
    direction = this.elementDirection('machine', filter.machine);
  }

  if (direction == null && filter.hasOwnProperty('tag')) {
    return this.elementDirection('tag', filter.tag);
  }

  return direction;
};


/**
 * Returns the opposite direction (from, to) from the side that a target
 * (machine, rule, etc) is on
 */
FwRule.prototype.oppositeDirection = function(filter) {
  var dir = this.direction(filter);

  if (dir == null) {
    return null;
  }
  return (dir == DIRECTIONS[0]) ? DIRECTIONS[1] : DIRECTIONS[0];
};



// --- Target methods



/**
 * Rule tags by direction
 */
FwRule.prototype.tags = function () {
  return {
    'from': this.raw.fromtag ? this.raw.fromtag : [],
    'to': this.raw.totag ? this.raw.totag : []
  };
};


/**
 * Rule machines
 */
FwRule.prototype.machines = function() {
  return {
    'from': this.raw.frommachine ? this.raw.frommachine : [],
    'to': this.raw.tomachine ? this.raw.tomachine : []
  };
}


/**
 * All rule tags
 */
FwRule.prototype.allTags = function () {
  var tags = {};

  if (this.raw.fromtag) {
    this.raw.fromtag.forEach(function (t) {
      tags[t] = 1;
    });
  }

  if (this.raw.totag) {
    this.raw.totag.forEach(function (t) {
      tags[t] = 1;
    });
  }

  return Object.keys(tags);
};


/**
 * All rule machines
 */
FwRule.prototype.allMachines = function () {
  var machines = {};

  if (this.raw.frommachine) {
    this.raw.frommachine.forEach(function (t) {
      machines[t] = 1;
    });
  }

  if (this.raw.tomachine) {
    this.raw.tomachine.forEach(function (t) {
      machines[t] = 1;
    });
  }

  return Object.keys(machines);
};



// --- DN helper functions



/**
 * Returns the DN for the rule
 */
FwRule.dn = function (fwrule, user, dc) {
  if (user == DC && dc) {
    return util.format('fwrule=%s, ou=fwrules, datacenter=%s, o=smartdc',
        fwrule, dc);
  }
  return util.format(
    'fwrule=%s, uuid=%s, ou=users, o=smartdc',
    fwrule, user);
};


/**
 * Returns the parent DN for the rule
 */
FwRule.parentDn = function (user, dc) {
  if (user == DC && dc) {
    return util.format('ou=fwrules, datacenter=%s, o=smartdc', dc);
  }

  if (user) {
    FwRule.validateUUID(user);
    return util.format('uuid=%s, ou=users, o=smartdc', user);
  }

  return 'ou=users, o=smartdc';
};


/**
 * Returns the DN based on the request
 */
FwRule.dnFromRequest = function (req) {
  var fwrule = req.params.fwrule;
  FwRule.validateUUID(fwrule);
  return FwRule.dn(fwrule, req.params.owner_uuid, req._datacenter);
};


/**
 * Returns the parent DN based on the request
 */
FwRule.parentDnFromRequest = function (req) {
  return FwRule.parentDn(req.params.owner_uuid, req._datacenter);
};


/**
 * Returns the datacenter DN
 */
FwRule.datacenterDn = function (dc) {
  return FwRule.parentDn(DC, dc);
};


/**
 * Validate the given UUID
 *
 * @param UUID {String} The UUID
 * @throws {restify Error} if the UUID invalid
 */
FwRule.validateUUID = function validateUUID(uuid) {
  if (!UUID_REGEX.test(uuid)) {
    throw new restify.InvalidArgumentError(
      util.format('UUID "%s" is invalid', uuid));
  }
}



// --- Exports



/**
 * Parses a rule written in the firewall DSL
 */
function parseRule(data) {
  var enabled = data.hasOwnProperty('enabled') ? data.enabled : false;

  if (!data.hasOwnProperty('rule')) {
    return { enabled: enabled };
  }

  var parsed = parser.parse(data.rule);
  // Parser should have taken care of all validation by this point
  var raw = {
    protocol: parsed.protocol,
    port: parsed.ports,
    action: parsed.action,
    enabled: enabled
  };

  if (data.hasOwnProperty('user')) {
    raw.user = data.user;
  }

  if (data.hasOwnProperty('owner_uuid')) {
    raw.user = data.owner_uuid;
  }

  for (var i in DIRECTIONS) {
    var dir = DIRECTIONS[i];
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



module.exports = {
  actions: ACTIONS,
  DIRECTIONS: DIRECTIONS,
  FwRule: FwRule,
  parseRule: parseRule,
  protocols: PROTOCOLS,
  ruleText: ruleText,
  targetTypes: TARGET_TYPES
};
