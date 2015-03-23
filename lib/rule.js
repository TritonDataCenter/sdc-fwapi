/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Firewall rule model
 */

var assert = require('assert-plus');
var clone = require('clone');
var mod_err = require('./errors');
var mod_rule = require('fwrule');
var restify = require('restify');
var util = require('util');
var util_ip = require('./util/ip');



// --- Globals



var UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;



// --- Internal helpers



/**
 * Calls callback for all of the firewall target types
 */
function forEachTarget(obj, callback) {
    for (var i in mod_rule.DIRECTIONS) {
        var dir = mod_rule.DIRECTIONS[i];
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
        enabled: typeof (raw.enabled) === 'boolean' ? raw.enabled :
            (raw.enabled === 'true'),
        objectclass: raw.objectclass,
        parsed: {
            action: raw.action,
            from: [],
            protocol: {
                name: raw.protocol
            },
            to: []
        },
        uuid: raw.uuid,
        version: raw.version
    };

    if (raw.hasOwnProperty('ports')) {
        data.parsed.protocol.targets = typeof (raw.ports) === 'object' ?
            raw.ports : [ raw.ports ];
    }

    if (raw.hasOwnProperty('types')) {
        data.parsed.protocol.targets = typeof (raw.types) === 'object' ?
            raw.types : [ raw.types ];
    }

    if (raw.hasOwnProperty('description')) {
        data.description = raw.description;
    }

    if (typeof (raw.enabled) === 'boolean') {
        data.enabled = raw.enabled;
    }

    if (raw.hasOwnProperty('owner')) {
        data.owner_uuid = raw.owner;
    }

    mod_rule.DIRECTIONS.forEach(function (dir) {
        mod_rule.TARGET_TYPES.forEach(function (type) {
            var key = dir + type;
            if (!raw.hasOwnProperty(key)) {
                return;
            }
            var targets =
                typeof (raw[key]) === 'object' ? raw[key] : [ raw[key] ];

            targets.forEach(function (t) {
                if (type === 'ip') {
                    t = util_ip.ntoa(t);
                }

                if (type === 'subnet') {
                    t = fromRawSubnet(t);
                }

                if (type === 'tag') {
                    var lastEqIdx = t.lastIndexOf('=');
                    if (lastEqIdx !== -1) {
                        var dividerIdx = Number(t.substring(lastEqIdx + 1));
                        var tagKey = t.substring(0, dividerIdx);
                        var tagVal = t.substring(dividerIdx + 1, lastEqIdx);
                        if (tagVal.length !== 0) {
                            t = [tagKey, tagVal];
                        } else {
                            t = tagKey;
                        }
                    }
                }

                data.parsed[dir].push([type, t]);
            });
        });
    });

    return data;
}



// --- Rule model: interface is as required by 'ufdsmodel.js'



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

    // Data is from UFDS:
    if (data.objectclass) {
        assert.equal(data.objectclass, Rule.objectclass,
                'Incorrect objectclass returned from UFDS');
        mod_rule.FwRule.call(this, ruleFromUFDS(data));
    } else {
        // Only require the global flag when coming in via the API:
        mod_rule.FwRule.call(this, data, { enforceGlobal: true });
    }

    this.dn = Rule.dn(this.uuid);
    this.id = this.uuid;
    this.idName = 'uuid';
}

util.inherits(Rule, mod_rule.FwRule);

Rule.objectclass = 'fwrule';


Rule.prototype.raw = function () {
    var self = this;
    var raw = {
        action: this.action,
        enabled: this.enabled,
        objectclass: Rule.objectclass,
        protocol: this.protocol,
        uuid: this.uuid,
        version: this.version
    };

    if (this.hasOwnProperty('description')) {
        raw.description = this.description;
    }

    if (this.hasOwnProperty('owner_uuid')) {
        raw.owner = this.owner_uuid;
    }

    if (this.hasOwnProperty('ports')) {
        raw.ports = this.ports;
    }

    if (this.hasOwnProperty('types')) {
        raw.types = this.types;
    }

    mod_rule.DIRECTIONS.forEach(function (dir) {
        mod_rule.TARGET_TYPES.forEach(function (type) {
            var name = type + 's';
            var val;

            if (self[dir].hasOwnProperty(name) &&
                self[dir][name].length !== 0) {
                if (type === 'ip') {
                    val = self[dir][name].map(function (ip) {
                        return util_ip.aton(ip);
                    });
                } else if (type === 'subnet') {
                    val = self[dir][name].map(function (subnet) {
                        return rawSubnet(subnet);
                    });
                } else if (type === 'tag') {
                    // Tag storage in UFDS:
                    //
                    // Tags are stored in the format "key=val=n", where
                    // n is the length of key
                    val = self[dir][name].map(function (tag) {
                        var tagKey = tag;
                        var tagVal = '';
                        if (typeof (tag) === 'object') {
                            tagKey = tag[0];
                            tagVal = tag[1];
                        }

                        return util.format('%s=%s=%d', tagKey, tagVal,
                            tagKey.length);
                    });
                } else {
                    val = self[dir][name];
                }

                raw [dir + type] = val;
            }
        });
    });

    return raw;
};


/**
 * Generates a new version for the current rule
 */
Rule.prototype.incrementVersion = function () {
    this.version = mod_rule.generateVersion();
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
    if (!UUID_REGEX.test(req.params.uuid)) {
        throw new mod_err.InvalidParamsError(mod_err.INVALID_MSG,
            [ mod_err.invalidParam('uuid', 'Invalid UUID') ]);
    }

    return Rule.dn(req.params.uuid);
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
function createRule(data, opts) {
    return new Rule(data, opts);
}


/**
 * Translates the raw (UFDS) form of a subnet to its serializable form
 */
function fromRawSubnet(sub) {
    var split = sub.split('/');
    return util_ip.ntoa(split[0]) + '/' + split[1];
}


/**
 * Returns the raw (UFDS) form of an IP
 */
function rawIP(ipVal) {
    return util_ip.aton(ipVal);
}


/**
 * Returns the raw (UFDS) form of a subnet
 */
function rawSubnet(sub) {
    var split = sub.split('/');
    return util_ip.aton(split[0]) + '/' + split[1];
}



module.exports = {
    ACTIONS: mod_rule.ACTIONS,
    create: createRule,
    DIRECTIONS: mod_rule.DIRECTIONS,
    objectclass: Rule.objectclass,
    parentDn: Rule.parentDn,
    PROTOCOLS: mod_rule.PROTOCOLS,
    Rule: Rule,
    TARGET_TYPES: mod_rule.TARGET_TYPES,
    raw: {
        ip: rawIP,
        subnet: rawSubnet
    }
};
