/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Helpers for filtering UFDS data
 */

'use strict';

var fw = require('../rule');
var mod_err = require('../errors');
var mod_filter = require('moray-filter');
var mod_jsprim = require('jsprim');
var mod_rule = require('../rule');
var restify = require('restify');
var util = require('util');
var validators = require('fwrule').validators;

var fmt = util.format;
var hasKey = mod_jsprim.hasKey;
var isEmpty = mod_jsprim.isEmpty;

var AndFilter = mod_filter.AndFilter;
var EqualityFilter = mod_filter.EqualityFilter;
var OrFilter = mod_filter.OrFilter;
var SubstringFilter = mod_filter.SubstringFilter;
var OwnerlessFilter = mod_filter.parse('(!(owner=*))');


// --- Internal helpers


function eq(attribute, val) {
    return new EqualityFilter({
        attribute: attribute,
        value: val
    });
}


function and(filters) {
    return new AndFilter({ filters: filters });
}


function or(filters) {
    return new OrFilter({ filters: filters });
}


function substring(attribute, substrs) {
    return new SubstringFilter({
        attribute: attribute,
        initial: '',
        any: substrs,
        final: ''
    });
}


/**
 * Turn a value into an array, unless it is one already,
 * or is an object.
 */
function arrayify(obj) {
    if (typeof (obj) === 'object') {
        return obj;
    }

    return [ obj ];
}


function ruleCommonFilter(opts) {
    var params = opts.params;
    var filter = [];

    if (hasKey(opts, 'operation') && (opts.operation !== 'OR')) {
        throw new restify.InvalidArgumentError(
            'Invalid operation "%s" for filter', opts.operation);
    }

    if (hasKey(params, 'enabled')) {
        if ((params.enabled !== 'true') && (params.enabled !== 'false')) {
            throw new restify.InvalidArgumentError(
                'Invalid value for enabled: must be true or false');
        }
        filter.push(eq('enabled', params.enabled));
    }


    if (hasKey(params, 'log')) {
        if ((params.log !== 'true') && (params.log !== 'false')) {
            throw new restify.InvalidArgumentError(
                'Invalid value for log: must be true or false');
        }
        filter.push(eq('log', params.log));
    }

    if (hasKey(params, 'port')) {
        if (!validators.validatePortOrAll(params.port)) {
            throw new restify.InvalidArgumentError(
                'port is invalid');
        }
        filter.push(eq('port', params.port.toLowerCase()));
    }

    if (hasKey(params, 'protocol')) {
        if (!validators.validateProtocol(params.protocol)) {
            throw new restify.InvalidArgumentError(
                fmt('Invalid value for protocol: must be one of: %s',
                    fw.PROTOCOLS.join(', ')));
        }
        filter.push(eq('protocol', params.protocol));
    }

    if (hasKey(params, 'action')) {
        if (!validators.validateAction(params.action)) {
            throw new restify.InvalidArgumentError(
                fmt('Invalid value for action: must be one of: %s',
                    fw.ACTIONS.join(', ')));
        }
        filter.push(eq('action', params.action));
    }

    // Allow passing in "global" to include global rules in our query
    if (params.global) {
        filter.push(OwnerlessFilter);
    }

    return filter;
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
 *     - log {Boolean}
 *     - port {Integer}
 *     - protocol {String}
 *     - ip {String or Array}
 *     - machine {String or Array}
 *     - subnet {String or Array}
 *     - tag {String or Array}
 */
function ruleMorayFilter(opts) {
    var log = opts.log;
    var params = opts.params;

    var filter = ruleCommonFilter(opts);

    // tags are a special case: we can filter on tag key alone, or both
    // key and value
    if (hasKey(params, 'tag')) {
        params.tag = arrayify(params.tag);

        if (Array.isArray(params.tag)) {
            params.tag = params.tag.reduce(function (acc, arrTag) {
                acc[arrTag] = true;
                return acc;
            }, {});
        }

        if (!isEmpty(params.tag)) {
            var tagFilter = [];

            for (var t in params.tag) {
                // See "Tag storage in Moray" in lib/rule.js for
                // the explanation of how tags are stored

                if (params.tag[t] === true) {
                    // Looking for all tags with a given key (don't care
                    // about values)
                    tagFilter.push(eq('fromtagkeys', t));
                    tagFilter.push(eq('totagkeys', t));
                } else {
                    // Looking for key=value, though we still want to get
                    // rules that refer only to the key name

                    // This gets tags that just have the key, no value
                    // (eg "FROM tag foo TO ...), since these apply too.
                    var emptyVal = fmt('%s==%d', t, t.length);
                    tagFilter.push(eq('fromtags', emptyVal));
                    tagFilter.push(eq('totags', emptyVal));

                    var tagVals = util.isArray(params.tag[t]) ?
                        params.tag[t] : [ params.tag[t] ];

                    for (var v in tagVals) {
                        var tagVal = fmt('%s=%s=%d', t, tagVals[v], t.length);
                        tagFilter.push(eq('fromtags', tagVal));
                        tagFilter.push(eq('totags', tagVal));
                    }
                }
            }

            filter.push(or(tagFilter));
        }
    }

    // Other non-tag rule target types
    fw.TARGET_TYPES.forEach(function (type) {
        if (type === 'tag') {
            return;
        }

        if (hasKey(params, type)) {
            var types = arrayify(params[type]);
            if (types.length !== 0) {
                filter.push(or(types.reduce(function (arr, val) {
                    arr.push(eq('from' + type + 's', val));
                    arr.push(eq('to' + type + 's', val));
                    return arr;
                }, [])));
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
    if (hasKey(params, 'owner_uuid')) {
        var ownerFilter = eq('owner', params.owner_uuid);

        if (opts.ownerlessRules) {
            ownerFilter = or([ ownerFilter, OwnerlessFilter ]);
        }

        if (opts.operation !== 'OR') {
            // This is just another condition to add to the list of things
            // to AND
            filter.push(ownerFilter);
        } else {
            // The owner filter is ANDed with the rest of the filter, so stick
            // an OR in front of them
            filter = [ ownerFilter, or(filter) ];
            needsAND = true;
        }
    }

    // If nothing's been selected to filter on, we just grab all rules
    if (filter.length === 0) {
        return '(uuid=*)';
    }

    var filterTxt;
    if (opts.operation !== 'OR' || needsAND) {
        filterTxt = and(filter).toString();
    } else {
        filterTxt = or(filter).toString();
    }

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
 *     - log {Boolean}
 *     - port {Integer}
 *     - protocol {String}
 *     - ip {String or Array}
 *     - machine {String or Array}
 *     - subnet {String or Array}
 *     - tag {String or Array}
 */
function ruleUFDSFilter(opts) {
    var log = opts.log;
    var params = opts.params;

    var filter = ruleCommonFilter(opts);

    // tags are a special case: we can filter on tag key alone, or both
    // key and value
    if (hasKey(params, 'tag')) {
        params.tag = arrayify(params.tag);

        if (util.isArray(params.tag)) {
            params.tag = params.tag.reduce(function (acc, arrTag) {
                acc[arrTag] = true;
                return acc;
            }, {});
        }

        if (!isEmpty(params.tag)) {
            var tagFilter = [];

            for (var t in params.tag) {
                // See "Tag storage in UFDS" in lib/rule.js for
                // the explanation of how tags are stored

                if (params.tag[t] === true) {
                    // Looking for all tags with a given key (don't care
                    // about values)
                    var tagName = [ t + '=', '=' + t.length ];
                    tagFilter.push(substring('fromtag', tagName));
                    tagFilter.push(substring('totag', tagName));

                } else {
                    // Looking for key=value, though we still want to get
                    // rules that refer only to the key name

                    // This gets tags that just have the key, no value
                    // (eg "FROM tag foo TO ...), since these apply too.
                    var emptyVal = [ fmt('%s==%d', t, t.length) ];
                    tagFilter.push(substring('fromtag', emptyVal));
                    tagFilter.push(substring('totag', emptyVal));

                    var tagVals = util.isArray(params.tag[t]) ?
                        params.tag[t] : [ params.tag[t] ];

                    for (var v in tagVals) {
                        var tagVal =
                            [ fmt('%s=%s=%d', t, tagVals[v], t.length) ];
                        tagFilter.push(substring('fromtag', tagVal));
                        tagFilter.push(substring('totag', tagVal));
                    }
                }
            }

            filter.push(or(tagFilter));
        }
    }

    // Other non-tag rule target types
    fw.TARGET_TYPES.forEach(function (type) {
        if (type === 'tag') {
            return;
        }

        if (hasKey(params, type)) {
            var types = arrayify(params[type]);
            if (types.length !== 0) {
                filter.push(or(types.reduce(function (arr, val) {
                    if (type === 'ip') {
                        val = mod_rule.raw.ip(val);
                    }

                    if (type === 'subnet') {
                        if (!validators.validateIPv4subnet(val)) {
                            throw mod_err.invalidParamErr('subnet');
                        }

                        val = mod_rule.raw.subnet(val);
                    }

                    arr.push(substring('from' + type, [ val ]));
                    arr.push(substring('to' + type, [ val ]));
                    return arr;
                }, [])));
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
    if (hasKey(params, 'owner_uuid')) {
        var ownerFilter = eq('owner', params.owner_uuid);

        if (opts.ownerlessRules) {
            ownerFilter = or([ ownerFilter, OwnerlessFilter ]);
        }

        if (opts.operation !== 'OR') {
            // This is just another condition to add to the list of things
            // to AND
            filter.push(ownerFilter);
        } else {
            // The owner filter is ANDed with the rest of the filter, so stick
            // an OR in front of them
            filter = [ ownerFilter, or(filter) ];
            needsAND = true;
        }
    }

    if (filter.length === 0) {
        return '';
    }

    var filterTxt;
    if (opts.operation !== 'OR' || needsAND) {
        filterTxt = and(filter).toString();
    } else {
        filterTxt = or(filter).toString();
    }

    log.debug('ruleUFDSFilter: filter=%s', filterTxt);
    return filterTxt;
}



module.exports = {
    morayRules: ruleMorayFilter,
    ufdsRules: ruleUFDSFilter
};
