/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * CN interaction helpers
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var done = common.done;
var ifErr = common.ifErr;
var fmt = require('util').format;
var mod_client = require('./client');
var mod_log = require('./log');
var restify = require('restify');
var VError = require('verror').VError;



// --- Globals



var ADMIN_IPS = {};
var LOG = mod_log.child({ component: 'cn' });
var NOT_FOUND_ERR = {
    code: 'ResourceNotFound',
    message: 'rule not found'
};
var POLL_INTERVAL = 500;
var POLL_TIMEOUT = 5000;
var RVM_NOT_FOUND_ERR = {
    code: 'ResourceNotFound',
    message: 'remote VM not found'
};



// --- Globals



/**
 * Check a URL on a CN, retrying until POLL_TIMEOUT if we get the specified
 * error code
 */
function checkUrl(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.string(opts.desc, 'opts.desc');
    assert.string(opts.errCode, 'opts.errCode');
    assert.string(opts.server_uuid, 'opts.server_uuid');
    assert.string(opts.url, 'opts.url');

    t.ok(opts.server_uuid, 'server_uuid=' + opts.server_uuid);

    getClient(t, opts.server_uuid, function (err, client) {
        if (err) {
            return callback(err);
        }

        var start = Date.now();
        /*jsl:ignore*/
        var timeout;
        /*jsl:end*/

        function checkIt() {
            client.get(opts.url, function (err2, req, res, obj) {
                var elapsed = Date.now() - start;

                if (err2 && err2.body && err2.body.code == opts.errCode &&
                    (elapsed < POLL_TIMEOUT)) {

                    // We haven't hit our timeout yet, so keep trying
                    LOG.trace({ start: start.toString(), elapsed: elapsed },
                        'timeout not hit: retrying' + opts.desc);
                    timeout = setTimeout(checkIt, POLL_INTERVAL);
                    return;
                }

                LOG.debug({ start: start.toString(), elapsed: elapsed },
                    'poll timeout exceeded' + opts.desc);

                return callback(err2, req, res, obj);
            });
        }

        timeout = setTimeout(checkIt, POLL_INTERVAL);
    });
}


/**
 * Creates a remote VM object based on a VM.js VM object
 * (stolen from fw/lib/util/vm.js)
 */
function createRemoteVM(vm) {
    var err;
    var ips = {};
    var rvm = {};
    var uuid = vm.uuid;

    if (!uuid) {
        err = new VError('Remote VM must have UUID');
        err.details = vm;
        throw err;
    }
    rvm.uuid = uuid;

    if (vm.hasOwnProperty('nics')) {
        vm.nics.forEach(function (nic) {
            if (nic.hasOwnProperty('ip') && nic.ip !== 'dhcp') {
                ips[nic.ip] = 1;
            }
        });
    }

    if (vm.hasOwnProperty('ips')) {
        vm.ips.forEach(function (ip) {
            ips[ip] = 1;
        });
    }

    if (objEmpty(ips)) {
        err = new VError(
            'Remote VM "%s": missing IPs', uuid);
        err.details = vm;
        throw err;
    }

    rvm.ips = Object.keys(ips).sort();

    if (vm.hasOwnProperty('tags') && !objEmpty(vm.tags)) {
        rvm.tags = {};
        for (var t in vm.tags) {
            rvm.tags[t] = vm.tags[t];
        }
    }

    if (vm.hasOwnProperty('owner_uuid')) {
        // XXX: validate UUID
        rvm.owner_uuid = vm.owner_uuid;
    }

    return rvm;
}


/**
 * Get the admin IP for a CN
 */
function getAdminIP(t, uuid, callback) {
    if (ADMIN_IPS.hasOwnProperty(uuid)) {
        return callback(null, ADMIN_IPS[uuid]);
    }

    var napi = mod_client.get('napi');
    napi.listNics({ nic_tags_provided: 'admin', belongs_to_uuid: uuid },
        function (err, nics) {
        if (ifErr(t, err, 'listNics for CN ' + uuid)) {
            return callback(err);
        }

        t.equal(nics.length, 1, '1 admin nic found for CN ' + uuid);
        ADMIN_IPS[uuid] = nics[0].ip;
        return callback(null, nics[0].ip);
    });
}


/**
 * Get a restify client for a CN
 */
function getClient(t, server, callback) {
    getAdminIP(t, server, function (err, ip) {
        if (common.ifErr(t, err, 'creating CN client')) {
            err.client = true;
            return callback(err);
        }

        return callback(null, restify.createJsonClient({
            agent: false,
            url: 'http://' + ip + ':2021'
        }));
    });
}


/**
 * Returns true if the object has no keys
 * (stolen from fw/lib/util/vm.js)
 */
function objEmpty(obj) {
    /* JSSTYLED */
    /*jsl:ignore*/
    for (var k in obj) {
        return false;
    }
    /* JSSTYLED */
    /*jsl:end*/

    return true;
}



// --- Exports



/**
 * Get a VM's firewall status from firewaller on a CN
 */
function getFwStatus(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.vm, 'opts.vm');
    assert.string(opts.vm.uuid, 'opts.vm.uuid');
    assert.string(opts.vm.server_uuid, 'opts.vm.server_uuid');
    assert.optionalBool(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');

    var desc = fmt(' (server %s, rule uuid=%s)', opts.vm.server_uuid,
        opts.vm.uuid);
    var checkOpts = {
        desc: desc,
        errCode: 'ResourceNotFound',
        server_uuid: opts.vm.server_uuid,
        url: '/vms/' + opts.vm.uuid + '/status'
    };

    checkUrl(t, checkOpts, function (err, req, res, obj) {
        if (err && err.client) {
            // Couldn't get the client - no sense in going further
            return done(err, null, t, callback);
        }

        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return done(err, null, t, callback);
        }

        if (common.ifErr(t, err, 'getting VM status' + desc)) {
            return done(err, null, t, callback);
        }

        if (opts.exp) {
            t.equal(obj.running, opts.exp, 'status' + desc);
        }

        return done(null, obj, t, callback);
    });
}


/**
 * Get a rule from firewaller on a CN
 */
function getRule(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.string(opts.server_uuid, 'opts.server_uuid');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');

    var desc = fmt(' (server %s, rule uuid=%s)', opts.server_uuid, opts.uuid);
    var checkOpts = {
        desc: desc,
        errCode: 'ResourceNotFound',
        server_uuid: opts.server_uuid,
        url: '/rules/' + opts.uuid
    };

    // XXX: Should actually be checking that the req_id that we care about
    // made it to the firewaller
    checkUrl(t, checkOpts, function (err, req, res, obj) {
        if (err && err.client) {
            // Couldn't get the client - no sense in going further
            return done(err, null, t, callback);
        }

        if (opts.expErr) {
            t.ok(err, 'expected error' + desc);
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            if (obj && obj.rule) {
                t.deepEqual(obj, {}, 'rule found when error expected' + desc);
            }

            return done(err, null, t, callback);
        }

        if (common.ifErr(t, err, 'getting rule' + desc)) {
            return done(err, null, t, callback);
        }

        if (opts.exp) {
            var newExp = clone(opts.exp);
            // firewaller adds this property - no sense in explicitly
            // calling it out in all tests:
            newExp.created_by = 'fwapi';

            ['uuid', 'version'].forEach(function (p) {
                if (!newExp.hasOwnProperty(p)) {
                    newExp[p] = obj[p];
                }
            });

            t.deepEqual(obj, newExp, 'full result' + desc);
        }

        return done(null, obj, t, callback);

    });
}


/**
 * Get a remote VM from firewaller on a CN
 */
function getRVM(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.string(opts.server_uuid, 'opts.server_uuid');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');

    var desc = fmt(' (server %s, rvm uuid=%s)', opts.server_uuid, opts.uuid);

    var checkOpts = {
        desc: desc,
        errCode: 'ResourceNotFound',
        server_uuid: opts.server_uuid,
        url: '/rvms/' + opts.uuid
    };

    checkUrl(t, checkOpts, function (err, req, res, obj) {
        if (err && err.client) {
            // Couldn't get the client - no sense in going further
            return done(err, null, t, callback);
        }

        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return done(err, null, t, callback);
        }

        if (common.ifErr(t, err, 'getting rvm' + desc)) {
            return done(err, null, t, callback);
        }

        if (opts.exp) {
            var newExp = createRemoteVM(opts.exp);
            t.deepEqual(obj, newExp, 'full result' + desc);
        }

        return done(null, obj, t, callback);
    });
}



module.exports = {
    getFwStatus: getFwStatus,
    getRule: getRule,
    getRVM: getRVM,
    get notFoundErr() {
        return clone(NOT_FOUND_ERR);
    },
    get rvmNotFoundErr() {
        return clone(RVM_NOT_FOUND_ERR);
    }
};
