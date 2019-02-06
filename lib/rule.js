/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

/*
 * Firewall rule model
 */

'use strict';

var assert = require('assert-plus');
var mod_err = require('./errors');
var mod_rule = require('fwrule');
var util = require('util');
var util_ip = require('./util/ip');
var validate = require('restify-warden');

var fmt = util.format;
var hasKey = require('jsprim').hasKey;

var tagEscape = require('fwrule/lib/rule').tagEscape;
var tagUnescape = require('fwrule/lib/rule').tagUnescape;

// --- Globals

/*
 * When storing the raw Rule form in Moray, we give it a version number so that
 * older versions can be found and upgraded in the future.
 *
 * 1 - Initial version.
 * 2 - Save tag names/values unescaped, and index on "description".
 */
var MORAY_RAW_VERSION = 2;

var BUCKET = {
    desc: 'fwrules',
    name: 'fwapi_rules',
    constructor: Rule,
    version: MORAY_RAW_VERSION,
    schema: {
        index: {
            'uuid': {
                'type': 'string',
                'unique': true
            },
            '_v': { 'type': 'number' },
            'version': { 'type': 'string' },
            'description': { 'type': 'string' },
            'owner': { 'type': 'string' },
            'action': { 'type': 'string' },
            'protocol': { 'type': 'string' },
            'enabled': { 'type': 'boolean' },
            'fromwildcards': {
                'type': '[string]'
            },
            'towildcards': {
                'type': '[string]'
            },
            'fromips': {
                'type': '[ip]'
            },
            'toips': {
                'type': '[ip]'
            },
            'fromsubnets': {
                'type': '[subnet]'
            },
            'tosubnets': {
                'type': '[subnet]'
            },
            'fromtagkeys': {
                'type': '[string]'
            },
            'totagkeys': {
                'type': '[string]'
            },
            'fromtags': {
                'type': '[string]'
            },
            'totags': {
                'type': '[string]'
            },
            'fromvms': {
                'type': '[string]'
            },
            'tovms': {
                'type': '[string]'
            }
        }
    },
    morayVersion: 2
};




// --- Internal helpers



/**
 * Converts a rule from Moray to raw format
 */
function ruleFromMoray(raw) {
    var data = {
        enabled: typeof (raw.enabled) === 'boolean' ? raw.enabled :
            (raw.enabled === 'true'),
        objectclass: raw.objectclass,
        parsed: {
            priority: raw.priority,
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

    if (raw.protocol === 'ah' || raw.protocol === 'esp') {
        data.parsed.protocol.targets = [ 'all' ];
    }

    if (hasKey(raw, 'ports')) {
        // See "Port storage in Moray" for how ports get represented
        data.parsed.protocol.targets = raw.ports.map(function (port) {
            /* JSSTYLED */
            var matched = /^\[(\d+),(\d+)\]$/.exec(port);
            if (matched !== null) {
                var start = Number(matched[1]);
                var end = Number(matched[2]);

                if (start === end) {
                    return Number(matched[1]);
                } else if (start === 1 && end === 65535) {
                    return 'all';
                } else {
                    return {
                        start: start,
                        end: end
                    };
                }
            } else {
                return port;
            }
        });

    }

    if (hasKey(raw, 'types')) {
        data.parsed.protocol.targets = raw.types;
    }

    if (hasKey(raw, 'description')) {
        data.description = raw.description;
    }

    if (typeof (raw.enabled) === 'boolean') {
        data.enabled = raw.enabled;
    }

    if (hasKey(raw, 'owner')) {
        data.owner_uuid = raw.owner;
    }

    mod_rule.DIRECTIONS.forEach(function (dir) {
        mod_rule.TARGET_TYPES.forEach(function (type) {
            var key = dir + type + 's';
            if (!hasKey(raw, key)) {
                return;
            }
            var targets = raw[key];

            targets.forEach(function (t) {
                if (type === 'tag') {
                    var lastEqIdx = t.lastIndexOf('=');
                    if (lastEqIdx !== -1) {
                        var dividerIdx = Number(t.substring(lastEqIdx + 1));
                        var tagKey = t.substring(0, dividerIdx);
                        var tagVal = t.substring(dividerIdx + 1, lastEqIdx);

                        // Version 1 objects didn't save values unescaped, so
                        // we take care of that when we load them.
                        if (raw._v === 1) {
                            tagKey = tagUnescape(tagKey);
                            tagVal = tagUnescape(tagVal);
                        }

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

    if (hasKey(raw, 'ports')) {
        data.parsed.protocol.targets =
            (typeof (raw.ports) === 'object' ?  raw.ports  : [ raw.ports ])
            .map(function (port) {
                var matched = /^(\d+)-(\d+)$/.exec(port);
                if (matched !== null) {
                    return {
                        start: Number(matched[1]),
                        end: Number(matched[2])
                    };
                } else {
                    return port;
                }
            });
    }

    if (hasKey(raw, 'types')) {
        data.parsed.protocol.targets = typeof (raw.types) === 'object' ?
            raw.types : [ raw.types ];
    }

    if (hasKey(raw, 'description')) {
        data.description = raw.description;
    }

    if (typeof (raw.enabled) === 'boolean') {
        data.enabled = raw.enabled;
    }

    if (hasKey(raw, 'owner')) {
        data.owner_uuid = raw.owner;
    }

    mod_rule.DIRECTIONS.forEach(function (dir) {
        mod_rule.TARGET_TYPES.forEach(function (type) {
            var key = dir + type;
            if (!hasKey(raw, key)) {
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
                        var tagKey = tagUnescape(t.substring(0, dividerIdx));
                        var tagVal = tagUnescape(
                            t.substring(dividerIdx + 1, lastEqIdx));
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


function tagObj(inputList) {
    var tags = {};

    function addTag(tagName) {
        if (!tags[tagName]) {
            tags[tagName] = {
                all: false,
                values: []
            };
        }
    }

    inputList.forEach(function (el) {
        if (util.isArray(el)) {
            addTag(el[0]);
            tags[el[0]].values.push(el[1]);

        } else {
            addTag(el);
            tags[el].all = true;
        }
    });

    return tags;
}


// --- Rule model: interface is as required by 'lib/ufds/model.js'



/**
 * Create a Rule. `new Rule(data)`
 *
 * @param data {Object} data for instantiating the firewall rule. This can
 * either be:
 * - the public representation
 * - the raw response from Moray (determined to be this if data.value is
 *   present)
 * - the raw response from UFDS (determined to be this if data.objectclass is
 *   present)
 * @throws {restify.RESTError} if the given data is invalid.
 */
function Rule(data, app) {
    assert.object(data, 'fwrule data');
    assert.object(app, 'app');

    if (data.value) {
        // Data is from Moray:
        mod_rule.FwRule.call(this, ruleFromMoray(data.value));
        if (data._etag) {
            this.etag = data._etag;
        }
    } else if (data.objectclass) {
        // Data is from UFDS:
        assert.equal(data.objectclass, Rule.objectclass,
            'Incorrect objectclass returned from UFDS');
        mod_rule.FwRule.call(this, ruleFromUFDS(data));
    } else {
        // Only require the global flag when coming in via the API:
        mod_rule.FwRule.call(this, data, {
            maxVersion: app.config.fwrule_version,
            enforceSubnetMask: true,
            enforceGlobal: true
        });
    }

    this.app = app;
    this.dn = Rule.dn(this.uuid);
    this.id = this.uuid;
    this.idName = 'uuid';
}

util.inherits(Rule, mod_rule.FwRule);

Rule.objectclass = 'fwrule';

/**
 * Return the "raw" form of this rule, suitable for persisting to Moray
 */
Rule.prototype.rawMoray = function _ruleRawMoray() {
    var self = this;
    var allPorts = false;
    var raw = {
        action: this.action,
        enabled: this.enabled,
        objectclass: Rule.objectclass,
        priority: this.priority,
        protocol: this.protocol,
        uuid: this.uuid,
        version: this.version,
        _v: MORAY_RAW_VERSION
    };

    if (hasKey(this, 'description')) {
        raw.description = this.description;
    }

    if (hasKey(this, 'owner_uuid')) {
        raw.owner = this.owner_uuid;
    }

    /**
     * Port storage in Moray:
     *
     * Ports are represented as ranges of numbers, [start,end], so that once
     * MORAY-327 and MORAY-295 are finished, the "ports" field can be indexed
     * as the Postgres "numrange" type, and rules can be searched by the ports
     * that they affect. For example, searching for port 25 would return a rule
     * that uses the range 20-30. Because of this, we store 'PORT ALL' as the
     * full range of possible port numbers.
     */
    if (hasKey(this, 'ports')) {
        raw.ports = this.ports.map(function (port) {
            if (hasKey(port, 'start') &&
                hasKey(port, 'end')) {
                if (port.start === 1 && port.end === 65535)
                    allPorts = true;
                return fmt('[%s,%s]', port.start, port.end);
            } else if (port === 'all') {
                allPorts = true;
                return '[1,65535]';
            } else return fmt('[%s,%s]', port, port);
        });
    }

    if (allPorts) {
        raw.ports = ['[1,65535]'];
    }

    if (hasKey(this, 'types')) {
        raw.types = this.types;
    }

    mod_rule.DIRECTIONS.forEach(function (dir) {
        mod_rule.TARGET_TYPES.forEach(function (type) {
            var name = type + 's';
            var keys = {};
            var val;

            if (hasKey(self[dir], name) &&
                self[dir][name].length !== 0) {
                if (type === 'tag') {
                    /*
                     * Tag storage in Moray:
                     *
                     * Tags are stored in the format "key=val=n", where
                     * n is the length of key. This is done since Moray
                     * can't index nested objects' fields.
                     *
                     * We also save the keys in their own field, since you
                     * can't search for values in arrays using wildcards in
                     * Moray, so we need a way to search for all rules that
                     * use a given tag.
                     */
                    val = self[dir][name].map(function (tag) {
                        var tagKey = tag;
                        var tagVal = '';
                        if (typeof (tag) === 'object') {
                            tagKey = tag[0];
                            tagVal = tag[1];
                        }

                        keys[tagKey] = true;
                        return fmt('%s=%s=%d', tagKey, tagVal, tagKey.length);
                    });
                    raw[dir + 'tagkeys'] = Object.keys(keys);
                } else {
                    val = self[dir][name];
                }

                raw[dir + name] = val;
            }
        });
    });

    return raw;
};


/**
 * Return the "raw" form of this rule, suitable for persisting to UFDS
 */
Rule.prototype.rawUFDS = function _ruleRawUFDS() {
    var self = this;
    var allPorts = false;
    var raw = {
        action: this.action,
        enabled: this.enabled,
        objectclass: Rule.objectclass,
        protocol: this.protocol,
        uuid: this.uuid,
        version: this.version
    };

    if (hasKey(this, 'description')) {
        raw.description = this.description;
    }

    if (hasKey(this, 'owner_uuid')) {
        raw.owner = this.owner_uuid;
    }

    if (hasKey(this, 'ports')) {
        raw.ports = this.ports.map(function (port) {
            if (hasKey(port, 'start') &&
                hasKey(port, 'end')) {
                if (port.start === 1 && port.end === 65535)
                    allPorts = true;
                return port.start + '-' + port.end;
            } else if (port === 'all') {
                allPorts = true;
                return 'all';
            } else return port;
        });
    }

    if (allPorts) {
        raw.ports = ['all'];
    }

    if (hasKey(this, 'types')) {
        raw.types = this.types;
    }

    mod_rule.DIRECTIONS.forEach(function (dir) {
        mod_rule.TARGET_TYPES.forEach(function (type) {
            var name = type + 's';
            var val;

            if (hasKey(self[dir], name) &&
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
                    // n is the length of key.
                    //
                    // For backwards compatibility reasons, they are stored
                    // in their escaped form. To support firewall rules that
                    // use escape sequences in tags, migrate to Moray.
                    val = self[dir][name].map(function (tag) {
                        var tagKey, tagVal;
                        if (typeof (tag) === 'object') {
                            tagKey = tagEscape(tag[0]);
                            tagVal = tagEscape(tag[1]);
                        } else {
                            tagKey = tagEscape(tag);
                            tagVal = '';
                        }

                        return fmt('%s=%s=%d', tagKey, tagVal, tagKey.length);
                    });
                } else {
                    val = self[dir][name];
                }

                raw[dir + type] = val;
            }
        });
    });

    return raw;
};


Rule.prototype.raw = function _ruleRaw() {
    throw new Error(
        '.rawMoray() or .rawUFDS() should be used in place of .raw()');
};


/**
 * Generate a value suitable for using in a Moray .batch() operation.
 */
Rule.prototype.batch = function () {
    var raw = this.rawMoray();
    return {
        bucket: BUCKET.name,
        key: raw.uuid,
        operation: 'put',
        value: raw,
        options: {
            etag: this.etag
        }
    };
};

/**
 * Return the serialized (API-facing) representation of this rule
 */
Rule.prototype.serialize = function _ruleSerialize(opts) {
    var self = this;
    var ser = mod_rule.FwRule.prototype.serialize.call(this);

    if (!opts || !opts.fields) {
        return ser;
    }

    function addParsed() {
        if (!hasKey(ser, 'parsed')) {
            ser.parsed = {};
        }
    }

    opts.fields.forEach(function (f) {
        switch (f) {
            case 'parsed.action':
                addParsed();
                ser.parsed.action = self.action;
                break;

            case 'parsed.ports':
                if (!hasKey(self, 'ports')) {
                    break;
                }

                addParsed();
                ser.parsed.ports = self.ports.map(function (p) {
                    if (p !== 'all') {
                        return Number(p);
                    }

                    return p;
                });
                break;

            case 'parsed.protocol':
                addParsed();
                ser.parsed.protocol = self.protocol;
                break;

            case 'parsed.tags':
                addParsed();
                ser.parsed.fromtags = tagObj(self.from.tags);
                ser.parsed.totags = tagObj(self.to.tags);
                break;

            default:
                break;
        }
    });

    return ser;
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
    return fmt('uuid=%s, ou=fwrules, o=smartdc', uuid);
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
    if (!validate.isUUID(req.params.uuid)) {
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
 * Translates the raw (UFDS) form of an IPv4 subnet to its serializable form
 */
function fromRawSubnet(sub) {
    var split = sub.split('/');
    var mask = (0xffffffff << (32 - Number(split[1]))) >>> 0;
    var ip = (Number(split[0]) & mask) >>> 0;
    return util_ip.ntoa(ip) + '/' + split[1];
}


/**
 * Returns the raw (UFDS) form of an IPv4 address
 */
function rawIP(ipVal) {
    return util_ip.aton(ipVal);
}


/**
 * Returns the raw (UFDS) form of an IPv4 subnet
 */
function rawSubnet(sub) {
    var split = sub.split('/');
    return util_ip.aton(split[0]) + '/' + split[1];
}



module.exports = {
    BUCKET: BUCKET,
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
