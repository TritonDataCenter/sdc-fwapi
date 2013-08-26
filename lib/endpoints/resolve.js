/*
 * Copyright 2013 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for retrieving VM rules
 */

var common = require('./common');
var fw = require('../rule');
var restify = require('restify');
var util = require('util');



// --- Internal helpers



/**
 * Validate shared request params
 */
function validateReqParams(req, res, next) {
    // XXX: Do we actually want to limit this?
    if (!req.params.owner_uuid) {
        return next(new restify.MissingParameterError(
                    '"owner_uuid" parameter required'));
    }

    return next();
}


/**
 * For targets specified by params, determine the targets on the other side
 * of the rules
 */
function resolveTargets(rules, params, log, callback) {
    var allVMs = false;
    var sideData = {
        tags: {},
        vms: {}
    };
    if (params.hasOwnProperty('vms')) {
        params.vms = params.vms.reduce(function (acc, vm) {
            acc[vm] = 1;
            return acc;
        }, {});
    }

    function addOtherSideData(rule, d) {
        if ((d === 'from' && rule.action === 'allow') ||
            (d === 'to' && rule.action === 'block')) {
            log.debug(
                'resolveTargets: rule %s: match on side %s, but action is %s',
                rule.uuid, d, rule.action);
            return;
        }

        var otherSide = d == 'from' ? 'to' : 'from';

        if (rule[otherSide].wildcards.indexOf('vmall') !== -1) {
            allVMs = true;
        }

        rule[otherSide].tags.forEach(function (tag) {
            if (!util.isArray(tag)) {
                sideData.tags[tag] = true;
            } else {
                if (sideData.tags[tag[0]] !== true) {
                    if (!sideData.tags.hasOwnProperty(tag[0])) {
                        sideData.tags[tag[0]] = [];
                    }

                    sideData.tags[tag[0]].push(tag[1]);
                }
            }
        });
        rule[otherSide].vms.forEach(function (vm) {
            sideData.vms[vm] = 1;
        });
    }

    rules.forEach(function (rule) {
        var matched = false;

        log.debug({ params: params, from: rule.from, to: rule.to },
            'resolveTargets: rule %s: finding side matches', rule.uuid);

        fw.DIRECTIONS.forEach(function (dir) {
            if (rule[dir].wildcards.indexOf('vmall') !== -1) {
                log.debug('resolveTargets: matched rule=%s, dir=%s, allVMs',
                    rule.uuid, dir);
                matched = true;
                return addOtherSideData(rule, dir);
            }

            if (params.hasOwnProperty('tags')) {
                rule[dir].tags.forEach(function (tag) {
                    var tagKey = tag;
                    var tagVal = true;
                    if (util.isArray(tag)) {
                        tagKey = tag[0];
                        tagVal = tag[1];
                    }

                    // A tag in a rule can match if:
                    // - we wanted tag key, and the rule has tag key=<anything>
                    // - we wanted tag key=val, and the rule has key=val
                    // - we wanted tag key=val, and the rule has tag key (with
                    //   no value)
                    if (params.tags.hasOwnProperty(tagKey) &&
                        (params.tags[tagKey] === true ||
                        params.tags[tagKey] === tagVal ||
                        tagVal === true)) {

                        matched = true;
                        log.debug('resolveTargets: matched rule=%s, dir=%s, '
                            + 'tag=%s', rule.uuid, dir, tag);
                        return addOtherSideData(rule, dir);
                    }
                });
            }

            if (params.hasOwnProperty('vms')) {
                rule[dir].vms.forEach(function (vm) {
                    if (params.vms.hasOwnProperty(vm)) {
                        matched = true;
                        log.debug('resolveTargets: matched rule=%s, dir=%s, '
                            + 'vm=%s', rule.uuid, dir, vm);
                        return addOtherSideData(rule, dir);
                    }
                });
            }
            // XXX: subnet
        });

        if (!matched) {
            log.warn('resolveTargets: rule %s: no matching tags or VMs found',
                rule.uuid);
        }
    });

    for (var type in sideData) {
        if (type !== 'tags') {
            sideData[type] = Object.keys(sideData[type]).sort();
        }
    }

    sideData.allVMs = allVMs;
    if (params.hasOwnProperty('owner_uuid')) {
        sideData.owner_uuid = params.owner_uuid;
    }

    return callback(null, sideData);
}



// --- Restify handlers



/*
 * Returns all data necessary to firewall the given VM:
 * - All rules that apply to that VM or its tags
 * - The VM's tags
 * - IPs for VM mentioned in the rules
 * - IPs for tags mentioned in the rules
 */
function resolve(req, res, next) {
    // ips, owner_uuid, tags, vms

    common.filterUFDSrules(req.params, req._app, req.log,
        function (err, rules) {
        if (err) {
            return next(err);
        }

        resolveTargets(rules, req.params, req.log, function (err2, sideData) {
            if (err2) {
                return next(err2);
            }

            var payload = {
                rules: rules.map(function (r) {
                    return r.serialize();
                })
            };

            for (var type in sideData) {
                payload[type] = sideData[type];
            }

            res.send(200, payload);
            return next();
        });
    });
}



// --- Exports



/**
 * Registers endpoints with a restify server
 */
function register(server, before) {
    var allBefore = before.concat(validateReqParams);
    server.post({ path: '/resolve', name: 'resolve' },
            allBefore, resolve);
}



module.exports = {
    register: register
};
