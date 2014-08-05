/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Helpers for manipulating VMs
 */

var assert = require('assert-plus');
var async = require('async');
var clone = require('clone');
var common = require('./common');
var config = require('./config');
var done = common.done;
var fmt = require('util').format;
var ifErr = common.ifErr;
var mod_client = require('./client');
var mod_log = require('./log');
var util = require('util');
var VError = require('verror').VError;



// --- Globals



var VM_PARAMS = {
    image_uuid: config.test.provision_image,
    networks: [ { name: 'external' } ],
    brand: 'joyent',
    ram: 128
};
var VM_NUM = 0;
var LOG = mod_log.child({ component: 'vm' });
var POLL_INTERVAL = 500;
var VMS = {};


// --- Internal



/**
 * Provision a single VM
 */
function provisionOne(t, opts, callback) {
    assert.object(opts.vm, 'opts.vm');

    var client = opts.client || mod_client.get('vmapi');
    var desc = fmt(' (vm=%s)', JSON.stringify(opts.vm));
    var vmParams = clone(VM_PARAMS);

    for (var p in opts.vm) {
        vmParams[p] = opts.vm[p];
    }

    LOG.debug({ vm: opts.vm }, 'provisioning VM');
    client.createVm(vmParams, function (err, job) {
        if (ifErr(t, err, 'provision VM' + desc)) {
            t.deepEqual(vmParams, {}, 'VM params');
            LOG.error({ params: vmParams }, 'failed to create VM');
            return callback(err);
        }

        LOG.info({ vm: opts.vm, vm_uuid: job.vm_uuid, job_uuid: job.job_uuid },
            'waiting for VM to provision');
        /*jsl:ignore*/
        var timeout;
        /*jsl:end*/

        function checkState() {
            client.getVm({ uuid: job.vm_uuid }, function (err2, res) {
                if (err2) {
                    return callback(err2);
                }

                if (res.state == 'running') {
                    VMS[res.uuid] = clone(res);
                    LOG.debug({ vm_uuid: job.vm_uuid, vm: res },
                        'successfully provisioned VM');
                    return callback(null, res);
                }

                if (res.state == 'failed') {
                    LOG.error({ vm_uuid: job.vm_uuid, params: vmParams },
                        'failed to provision VM');
                    return callback(new VError(
                        'failed to provision VM %s (job %s)',
                        job.vm_uuid, job.job_uuid));
                }

                timeout = setTimeout(checkState, POLL_INTERVAL);
            });
        }

        timeout = setTimeout(checkState, POLL_INTERVAL);
    });
}


/**
 * Wait for a workflow job to complete
 */
function waitForJob(t, uuid, callback) {
    var client = mod_client.get('wfapi');
    /*jsl:ignore*/
    var timeout;
    /*jsl:end*/

    function checkJob() {
        client.get('/jobs/' + uuid, function (err, res) {
            if (err) {
                return callback(err);
            }

            if (res.execution != 'running' && res.execution !== 'queued') {
                t.equal(res.execution, 'succeeded', 'job '
                    + uuid + ' succeeded');

                return callback(null, res);
            }

            timeout = setTimeout(checkJob, POLL_INTERVAL);
        });
    }

    timeout = setTimeout(checkJob, POLL_INTERVAL);
}



// --- Exports


/**
 * Generate an alias for a VM
 */
function alias(num) {
    return fmt('fw-test-%d-%d', process.pid, VM_NUM++);
}


/**
 * Delete VMs
 */
function del(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');

    if (!opts.vms) {
        opts.vms = [];
    }
    if (opts.vm) {
        opts.vms.push(opts.vm);
    }

    async.map(opts.vms, function (uuid, cb) {
        var newOpts = clone(opts);
        newOpts.uuid = uuid;
        delOne(t, newOpts, cb);
    }, function (err, res) {
        return done(err, res, t, callback);
    });
}


/**
 * Delete all VMs created during this test
 */
function delAllCreated(t, callback) {
    assert.object(t, 't');
    assert.optionalFunc(callback, 'callback');

    return del(t, { vms: Object.keys(VMS) }, callback);
}


/**
 * Delete a single VM
 */
function delOne(t, opts, callback) {
    assert.string(opts.uuid, 'opts.uuid');

    var client = opts.client || mod_client.get('vmapi');
    var desc = fmt(' (vm=%s)', opts.uuid);

    LOG.debug({ vm: opts.uuid }, 'deleting VM');

    var delParams = { uuid: opts.uuid };

    client.deleteVm(delParams, function (err, job) {
        if (ifErr(t, err, 'delete VM' + desc)) {
            t.deepEqual(delParams, {}, 'VM delete params');
            return callback(err);
        }

        LOG.info({ vm_uuid: job.vm_uuid, job_uuid: job.job_uuid },
            'waiting for VM to delete');
        /*jsl:ignore*/
        var timeout;
        /*jsl:end*/

        function checkState() {
            client.getVm({ uuid: job.vm_uuid }, function (err2, res) {
                if (err2) {
                    return callback(err2);
                }

                if (res.state == 'destroyed') {
                    return callback(null, res);
                }

                if (res.state == 'failed') {
                    return callback(new VError(
                        'failed to provision VM %s (job %s)',
                        job.vm_uuid, job.job_uuid));
                }

                timeout = setTimeout(checkState, POLL_INTERVAL);
            });
        }

        timeout = setTimeout(checkState, POLL_INTERVAL);
    });
}


/**
 * Provision VMs and wait for those provisions to complete.
 */
function provision(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');

    if (!opts.vms) {
        opts.vms = [];
    }
    if (opts.vm) {
        opts.vms.push(opts.vm);
    }

    async.map(opts.vms, function (vm, cb) {
        var newOpts = clone(opts);
        newOpts.vm = vm;
        provisionOne(t, newOpts, cb);
    }, function (err, res) {
        if (err) {
            return done(err, null, t, callback);
        }

        var vms = res.filter(function (v) { return (v && v !== null); });
        LOG.info({ vms: vms }, 'provisioned VMs');

        return done(null, vms, t, callback);
    });
}


/**
 * Update a VM
 */
function update(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.string(opts.uuid, 'opts.uuid');
    assert.object(opts.params, 'opts.params');

    var client = opts.client || mod_client.get('vmapi');
    var desc = fmt(' (vm=%s, update=%s)', opts.uuid,
        JSON.stringify(opts.params));

    LOG.debug({ uuid: opts.uuid, params: opts.params }, 'updating VM');

    client.updateVm({ payload: opts.params, uuid: opts.uuid },
        function (err, job) {
        if (ifErr(t, err, 'update VM' + desc)) {
            t.deepEqual(opts.params, {}, 'VM update params');
            return done(err, null, t, callback);
        }

        LOG.info({
            job_uuid: job.job_uuid,
            params: opts.params,
            vm_uuid: job.vm_uuid
        }, 'waiting for VM to update');

        waitForJob(t, job.job_uuid, function (err2, res) {
            if (err2) {
                return done(err, null, t, callback);
            }

            client.getVm({ uuid: job.vm_uuid }, function (err3, res2) {
                if (ifErr(t, err, 'get VM' + desc)) {
                    return done(err, null, t, callback);
                }

                if (opts.exp) {
                    t.deepEqual(res2, opts.exp, 'full result' + desc);
                }

                if (opts.partialExp) {
                    // Check to make sure that only the partial changes have
                    // changed
                    var newExp = clone(VMS[opts.uuid]);
                    for (var p in opts.partialExp) {
                        newExp[p] = opts.partialExp[p];
                    }

                    newExp.last_modified = res2.last_modified;

                    t.deepEqual(res2, newExp, 'updated result' + desc);
                }

                VMS[job.vm_uuid] = clone(res2);
                return done(null, res2, t, callback);
            });
        });
    });
}


module.exports = {
    alias: alias,
    del: del,
    delAllCreated: delAllCreated,
    provision: provision,
    update: update
};
