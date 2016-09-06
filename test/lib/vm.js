/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
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
var POLL_INTERVAL = config.test.api_poll_interval;
var PROV_TIMEOUT = config.test.provision_timeout;
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
        var startTime = Date.now();
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
                    LOG.error({
                        job_uuid: job.job_uuid,
                        params: vmParams,
                        vm_uuid: job.vm_uuid
                    }, 'failed to provision VM');

                    return callback(new VError(
                        'failed to provision VM %s (job %s)',
                        job.vm_uuid, job.job_uuid));
                }

                if (Date.now() - startTime > PROV_TIMEOUT) {
                    LOG.error({
                        job_uuid: job.job_uuid,
                        params: vmParams,
                        vm_uuid: job.vm_uuid
                    }, 'timeout provisioning VM');

                    return callback(new VError(
                        'provision of VM %s (job %s) timed out',
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
    assert.arrayOfObject(opts.vms, 'opts.vms');
    assert.optionalFunc(callback, 'callback');

    var vms = opts.vms.map(function () { return {}; });
    for (var v in opts.vms) {
        opts.vms[v].vmNum = v;
    }

    async.map(opts.vms, function (vmParams, cb) {
        var newOpts = clone(opts);
        newOpts.vm = vmParams;

        provisionOne(t, newOpts, function (err, vm) {
            if (vm) {
                // Make sure we stick this VM back in its proper spot in the
                // vms array that we're returning:
                vms[vmParams.vmNum] = vm;
            }

            return cb();
        });
    }, function (err, res) {
        if (err) {
            return done(err, null, t, callback);
        }

        LOG.info({ vms: vms }, 'provisioned VMs');

        // Log information about the VMs and make sure we provisioned
        // the correct number
        t.equal(vms.length, opts.vms.length,
            fmt('%d VMs provisioned', opts.vms.length));

        for (var i = 0; i < opts.vms.length; i++) {
            var inVm = opts.vms[i];
            t.ok(vms[i], fmt('VM %d provisioned', i));

            if (vms[i]) {
                t.ok(vms[i].server_uuid, fmt('VM %d uuid=%s, server_uuid=%s',
                    i, vms[i].uuid, vms[i].server_uuid));
                if (inVm.server_uuid) {
                    t.equal(vms[i].server_uuid, inVm.server_uuid,
                        fmt('VM %d server_uuid is correct', i));
                }
            }
        }

        return done(null, vms, t, callback);
    });
}


/**
 * Add tags to a VM
 */
function addTags(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.string(opts.uuid, 'opts.uuid');
    assert.object(opts.tags, 'opts.tags');

    var client = opts.client || mod_client.get('vmapi');
    client.addMetadata('tags', { uuid: opts.uuid, metadata: opts.tags }, {},
        function (err, job) {
        if (ifErr(t, err, 'add tags to VM')) {
            t.deepEqual(opts.tags, {}, 'VM add tags');
            done(err, null, t, callback);
            return;
        }

        waitForJob(t, job.job_uuid, function (err2, res) {
            done(err2, null, t, callback);
        });
    });
}


/**
 * Add tags to a VM
 */
function removeTag(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.string(opts.uuid, 'opts.uuid');
    assert.string(opts.tag, 'opts.tag');

    var client = opts.client || mod_client.get('vmapi');
    client.deleteMetadata('tags', { uuid: opts.uuid }, opts.tag, {},
        function (err, job) {
        if (ifErr(t, err, 'remove tag from VM')) {
            t.deepEqual(opts.tag, '', 'VM remove tag');
            done(err, null, t, callback);
            return;
        }

        waitForJob(t, job.job_uuid, function (err2, res) {
            done(err2, null, t, callback);
        });
    });
}


/**
 * Add tags to a VM
 */
function updateTags(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.string(opts.uuid, 'opts.uuid');
    assert.object(opts.tags, 'opts.tags');

    var client = opts.client || mod_client.get('vmapi');
    client.setMetadata('tags', { uuid: opts.uuid, metadata: opts.tags }, {},
        function (err, job) {
        if (ifErr(t, err, 'update tags to VM')) {
            t.deepEqual(opts.tags, {}, 'VM update tags');
            done(err, null, t, callback);
            return;
        }

        waitForJob(t, job.job_uuid, function (err2, res) {
            done(err2, null, t, callback);
        });
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
    addTags: addTags,
    removeTag: removeTag,
    updateTags: updateTags,
    alias: alias,
    del: del,
    delAllCreated: delAllCreated,
    provision: provision,
    update: update
};
