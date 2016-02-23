/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

/*
 * Helpers for filtering UFDS data
 */

var fw = require('../rule');
var isEmpty = require('../util/obj').isEmpty;
var mod_err = require('../errors');
var mod_rule = require('../rule');
var restify = require('restify');
var util = require('util');
var validators = require('fwrule').validators;

var fmt = util.format;


// --- Internal helpers



/**
 * Turn a value into an array, unless it is one already.
 */
function arrayify(obj) {
    if (typeof (obj) === 'object') {
        return obj;
    }

    return obj.split(',');
}

function ruleCommonFilter(opts, filter) {
    var params = opts.params;

    if (opts.hasOwnProperty('operation') && (opts.operation !== 'OR')) {
        throw new restify.InvalidArgumentError(
            'Invalid operation "%s" for filter', opts.operation);
    }

    if (params.hasOwnProperty('enabled')) {
        if ((params.enabled != 'true') && (params.enabled != 'false')) {
            throw new restify.InvalidArgumentError(
                'Invalid value for enabled: must be true or false');
        }
        filter.push(fmt('(enabled=%s)', params.enabled));
    }

    if (params.hasOwnProperty('port')) {
        if (!validators.validatePortOrAll(params.port)) {
            throw new restify.InvalidArgumentError(
                'port is invalid');
        }
        filter.push(fmt('(port=%s)', params.port.toLowerCase()));
    }

    if (params.hasOwnProperty('protocol')) {
        if (!validators.validateProtocol(params.protocol)) {
            throw new restify.InvalidArgumentError(
                fmt('Invalid value for protocol: must be one of: %s',
                    fw.PROTOCOLS.join(', ')));
        }
        filter.push(fmt('(protocol=%s)', params.protocol));
    }

    if (params.hasOwnProperty('action')) {
        if (!validators.validateAction(params.action)) {
            throw new restify.InvalidArgumentError(
                fmt('Invalid value for action: must be one of: %s',
                fw.ACTIONS.join(', ')));
        }
        filter.push(fmt('(action=%s)', params.action));
    }

    // Allow passing in "global" to include global rules in our query
    if (params.global) {
        filter.push('(!(owner=*))');
    }
}


// --- Exports

/**
 * Constructs an LDAP filter for finding firewall rules in Moray
 *
 * Not only do some of the fields in Moray have slightly different names, but
 * using Moray directly allows for better, more correct indexes which allow us
 * to do fewer workarounds (i.e., using wildcards on both sides of queries due
 * to indexing as string instead of [string]).
 *
 * @param opts {Object}: options
 * - @param log {Object}: bunyan logger (required)
 * - @param ownerlessRules {Boolean}: if true, include "global" rules that have
 *     no owner_uuid (optional)
 * - @param params {Object}: filter parameters (required)
 *     Required:
 *     - operation {String} : 'AND' or 'OR' - whether the resulting filter
 *       is a logical AND or OR of all optional parameters
 *     Optional parameters:
 *     - action {String}
 *     - enabled {Boolean}
 *     - port {Integer}
 *     - protocol {String}
 *     - ip {String or Array}
 *     - machine {String or Array}
 *     - subnet {String or Array}
 *     - tag {String or Array}
 */
function ruleMorayFilter(opts) {
    var filter = [];
    var log = opts.log;
    var params = opts.params;

    ruleCommonFilter(opts, filter);

    function beginOR() {
        if (opts.operation !== 'OR') {
            filter.push('(|');
        }
    }

    // As in "forest moon of"
    function endOR() {
        if (opts.operation !== 'OR') {
            filter.push(')');
        }
    }

    // tags are a special case: we can filter on tag key alone, or both
    // key and value
    if (params.hasOwnProperty('tag')) {
        if (typeof (params.tag === 'string')) {
            params.tag = arrayify(params.tag);
        }

        if (util.isArray(params.tag)) {
            params.tag = params.tag.reduce(function (acc, arrTag) {
                acc[arrTag] = true;
                return acc;
            }, {});
        }

        if (!isEmpty(params.tag)) {
            beginOR();

            for (var t in params.tag) {
                // See "Tag storage in Moray" in lib/rule.js for
                // the explanation of how tags are stored

                if (params.tag[t] === true) {
                    // Looking for all tags with a given key (don't care
                    // about values)
                    filter.push(fmt('(fromtagkeys=%s)', t));
                    filter.push(fmt('(totagkeys=%s)', t));
                } else {
                    // Looking for key=value, though we still want to get
                    // rules that refer only to the key name

                    // This gets tags that just have the key, no value
                    // (eg "FROM tag foo TO ...), since these apply too.
                    filter.push(fmt('(fromtags=%s==%d)', t, t.length));
                    filter.push(fmt('(totags=%s==%d)', t, t.length));

                    var tagVals = util.isArray(params.tag[t]) ?
                        params.tag[t] : [ params.tag[t] ];

                    for (var v in tagVals) {
                        filter.push(fmt('(fromtags=%s=%s=%d)',
                            t, tagVals[v], t.length));
                        filter.push(fmt('(totags=%s=%s=%d)',
                            t, tagVals[v], t.length));
                    }
                }
            }

            endOR();
        }
    }

    // Other non-tag rule target types
    fw.TARGET_TYPES.forEach(function (type) {
        var name = type + 's';
        if (type === 'tag') {
            return;
        }

        if (params.hasOwnProperty(type)) {
            var types = arrayify(params[type]);
            if (types.length !== 0) {
                beginOR();

                types.forEach(function (val) {
                    filter.push(fmt('(from%s=%s)', name, val));
                    filter.push(fmt('(to%s=%s)', name, val));
                });

                endOR();
            }
        }
    });

    /*
     * We have now built up the list of things to filter on.
     * For AND this looks like:
     *     '(|', '(fromvms=X)', '(tovms=X), ')',
     *     '(|', '(fromtags=Y)', '(totags=Y), ')'
     * For OR this looks like:
     *     '(fromvms=X)', '(tovms=X)', '(fromtags=Y)', '(totags=Y)'
     */
    var needsAND = false;
    if (params.hasOwnProperty('owner_uuid')) {
        var ownerFilter = [ fmt('(owner=%s)', params.owner_uuid) ];

        if (opts.ownerlessRules) {
            ownerFilter.unshift('(|');
            ownerFilter.push('(!(owner=*))');
            ownerFilter.push(')');
        }

        if (opts.operation !== 'OR') {
            // This is just another condition to add to the list of things
            // to AND
            filter = ownerFilter.concat(filter);
        } else {
            // The owner filter is ANDed with the rest of the filter, so stick
            // an OR in front of them
            filter.unshift('(|');
            filter.push(')');
            filter = ownerFilter.concat(filter);
            needsAND = true;
        }
    }

    // If nothing's been selected to filter on, we just grab all rules
    if (filter.length === 0) {
        return '(uuid=*)';
    }

    if (opts.operation !== 'OR' || needsAND) {
        filter.unshift('(&');
        filter.push(')');
    } else {
        filter.unshift('(|');
        filter.push(')');
    }

    var filterTxt = filter.join('');

    log.debug('ruleMorayFilter: filter=%s', filterTxt);
    return filterTxt;
}


/**
 * Constructs an LDAP filter for finding firewall rules in UFDS
 *
 * Note that many of the firewall rule fields are unindexed in UFDS, which
 * means that search on those values is bad. To avoid searching on these
 * fields, switch to using the Moray support in FWAPI.
 *
 * @param opts {Object}: options
 * - @param log {Object}: bunyan logger (required)
 * - @param ownerlessRules {Boolean}: if true, include "global" rules that have
 *     no owner_uuid (optional)
 * - @param params {Object}: filter parameters (required)
 *     Required:
 *     - operation {String} : 'AND' or 'OR' - whether the resulting filter
 *       is a logical AND or OR of all optional parameters
 *     Optional parameters:
 *     - action {String}
 *     - enabled {Boolean}
 *     - port {Integer}
 *     - protocol {String}
 *     - ip {String or Array}
 *     - machine {String or Array}
 *     - subnet {String or Array}
 *     - tag {String or Array}
 */
function ruleUFDSFilter(opts) {
    var filter = [];
    var log = opts.log;
    var params = opts.params;

    function beginOR() {
        if (opts.operation !== 'OR') {
            filter.push('(|');
        }
    }

    // As in "forest moon of"
    function endOR() {
        if (opts.operation !== 'OR') {
            filter.push(')');
        }
    }

    ruleCommonFilter(opts, filter);

    // tags are a special case: we can filter on tag key alone, or both
    // key and value
    if (params.hasOwnProperty('tag')) {
        if (typeof (params.tag === 'string')) {
            params.tag = arrayify(params.tag);
        }

        if (util.isArray(params.tag)) {
            params.tag = params.tag.reduce(function (acc, arrTag) {
                acc[arrTag] = true;
                return acc;
            }, {});
        }

        if (!isEmpty(params.tag)) {
            beginOR();

            for (var t in params.tag) {
                // See "Tag storage in UFDS" in lib/rule.js for
                // the explanation of how tags are stored

                if (params.tag[t] === true) {
                    // Looking for all tags with a given key (don't care
                    // about values)
                    filter.push(fmt('(fromtag=*%s=*=%d*)', t, t.length));
                    filter.push(fmt('(totag=*%s=*=%d*)', t, t.length));

                } else {
                    // Looking for key=value, though we still want to get
                    // rules that refer only to the key name

                    // This gets tags that just have the key, no value
                    // (eg "FROM tag foo TO ...), since these apply too.
                    filter.push(fmt('(fromtag=*%s==%d*)', t, t.length));
                    filter.push(fmt('(totag=*%s==%d*)', t, t.length));

                    var tagVals = util.isArray(params.tag[t]) ?
                        params.tag[t] : [ params.tag[t] ];

                    for (var v in tagVals) {
                        filter.push(fmt('(fromtag=*%s=%s=*)', t, tagVals[v]));
                        filter.push(fmt('(totag=*%s=%s=*)', t, tagVals[v]));
                    }
                }
            }

            endOR();
        }
    }

    // Other non-tag rule target types
    fw.TARGET_TYPES.forEach(function (type) {
        if (type === 'tag') {
            return;
        }

        if (params.hasOwnProperty(type)) {
            var types = arrayify(params[type]);
            if (types.length !== 0) {
                beginOR();

                types.forEach(function (val) {
                    if (type == 'ip') {
                        val = mod_rule.raw.ip(val);
                    }

                    if (type == 'subnet') {
                        if (!validators.validateIPv4subnet(val)) {
                            throw mod_err.invalidParamErr('subnet');
                        }

                        val = mod_rule.raw.subnet(val);
                    }

                    filter.push(fmt('(from%s=*%s*)', type, val));
                    filter.push(fmt('(to%s=*%s*)', type, val));
                });

                endOR();
            }
        }
    });

    // We have now built up the list of things to filter on.
    // For AND this looks like:
    //     '(|', '(fromvm=X)', '(tovm=X), ')',
    //     '(|', '(fromtag=Y)', '(totag=Y), ')'
    // For OR this looks like:
    //     '(fromvm=X)', '(tovm=X)', '(fromtag=Y)', '(totag=Y)'

    var needsAND = false;
    if (params.hasOwnProperty('owner_uuid')) {
        var ownerFilter = [ fmt('(owner=%s)', params.owner_uuid) ];

        if (opts.ownerlessRules) {
            ownerFilter.unshift('(|');
            ownerFilter.push('(!(owner=*))');
            ownerFilter.push(')');
        }

        if (opts.operation !== 'OR') {
            // This is just another condition to add to the list of things
            // to AND
            filter = ownerFilter.concat(filter);
        } else {
            // The owner filter is ANDed with the rest of the filter, so stick
            // an OR in front of them
            filter.unshift('(|');
            filter.push(')');
            filter = ownerFilter.concat(filter);
            needsAND = true;
        }
    }

    if (filter.length === 0) {
        return '';
    }

    if (opts.operation !== 'OR' || needsAND) {
        filter.unshift('(&');
        filter.push(')');
    } else {
        filter.unshift('(|');
        filter.push(')');
    }

    var filterTxt = filter.join('');

    log.debug('ruleUFDSFilter: filter=%s', filterTxt);
    return filterTxt;
}



module.exports = {
    morayRules: ruleMorayFilter,
    ufdsRules: ruleUFDSFilter
};
