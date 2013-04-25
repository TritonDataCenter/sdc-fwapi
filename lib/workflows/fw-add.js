/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * FWAPI: add rule workflow
 */

// These must match the names available in the workflow VM:
var async = require('async');
var common = require('./common');
var cnShared = require('wf-shared').cnapi;
var sdcClients = require('sdc-clients');
var fwShared = require('wf-shared').fwapi;
var verror = require('verror');



// --- Globals



// Make jslint happy:
var cnapiUrl;
var ufdsDn;
var ufdsPassword;
var ufdsUrl;



var VERSION = '0.0.1';



// --- Workflow functions



/**
 * Validate all parameters necessary for the workflow
 */
function validateParams(job, callback) {
    var p;
    var globalsReq = {
        'CNAPI URL': cnapiUrl,
        'UFDS URL': ufdsUrl,
        'UFDS DN': ufdsDn,
        'UFDS password': ufdsPassword
    };

    var jobParamsReq = {
        'dn': 'UFDS DN',
        'rule': 'rule',
        'ufdsRaw': 'UFDS raw data'
    };

    for (p in globalsReq) {
        if (!globalsReq[p]) {
            return callback('No ' + p + ' workflow parameter provided');
        }
    }

    for (p in jobParamsReq) {
        if (!job.params[p]) {
            return callback('No ' + p + ' parameter provided');
        }
    }

    return callback(null, 'parameters validated successfully');
}


/**
 * Add the rule to UFDS
 */
function addToUFDS(job, callback) {
    var ufdsOptions = {
            url: ufdsUrl,
            bindDN: ufdsDn,
            bindPassword: ufdsPassword
    };

    job.log.info(ufdsOptions, 'Creating UFDS client');
    var ufds = new sdcClients.UFDS(ufdsOptions);
    ufds.on('error', function (err) {
            return callback(err);
    });

    ufds.on('ready', function () {
        return ufds.add(job.params.dn, job.params.ufdsRaw, function (err) {
            if (err) {
                return callback(err);
            }

            return callback(null, 'Added rule to UFDS');
        });
    });
}


/**
 * Start a provisioner task with CNAPI on each of the servers to add
 * the rules
 */
function cnapiAddRules(job, callback) {
    if (!job.params.fwapiServers || job.params.fwapiServers.length === 0) {
        return callback(null, 'No servers to send rules to');
    }

    var servers = {};
    var serversSent = [];
    // Use server info from CNAPI (if available) to determine if the
    // server is running 6.5
    if (job.params.cnapiSysinfos) {
        job.params.cnapiSysinfos.forEach(function (s) {
            if (s.hasOwnProperty('uuid')) {
                servers[s.uuid] = s;
            }
        });
    }

    var cnapi = new sdcClients.CNAPI({ url: cnapiUrl });
    job.params.taskIDs = [];

    async.forEach(job.params.fwapiServers, function (uuid, cb) {
        var endpoint = '/servers/' + uuid + '/fw/add';
        var firewall = {
            jobid: job.uuid,
            rules: [ job.params.rule ]
        };

        if (servers.hasOwnProperty(uuid) &&
            servers[uuid].hasOwnProperty('sysinfo') &&
            !servers[uuid].sysinfo.hasOwnProperty('SDC Version')) {
            job.log.info('server %s is 6.5: not sending firewall data', uuid);
            return cb();
        }

        serversSent.push(uuid);
        var remoteVMs = job.params.fwapiMatchingVMs.filter(function (rvm) {
            return (rvm.server_uuid != uuid);
        });

        if (remoteVMs.length) {
            firewall.remoteVMs = remoteVMs;
        }

        job.log.debug(firewall, 'Adding rules to server "%s"', uuid);
        return cnapi.post(endpoint, firewall,
            function (err, task) {
            if (err) {
                return cb(err);
            }
            job.log.debug(task, 'Server "%s": task', uuid);

            job.params.taskIDs.push({ server_uuid: uuid, task_id: task.id});
            return cb(null);
        });
    }, function (err) {
        if (err) {
            return callback(err);
        }

        if (serversSent.length === 0) {
            return callback(null,
                'Only 6.5 servers available: did not send firewall data');
        }

        return callback(null, 'Added rules to servers: '
            + serversSent.join(', '));
    });
}



// --- Exports



var workflow = module.exports = {
    name: 'fw-add-' + VERSION,
    version: VERSION,
    chain: [ {
        name: 'validate_params',
        timeout: 10,
        retry: 1,
        body: validateParams
    }, {
        name: 'vmapi.get_vms',
        timeout: 10,
        retry: 1,
        body: fwShared.getVMs
    }, {
        name: 'ufds.add_rule',
        timeout: 10,
        retry: 1,
        body: addToUFDS
    }, {
        name: 'cnapi.get_server_sysinfos',
        timeout: 10,
        retry: 1,
        body: cnShared.sysinfoList
    }, {
        name: 'cnapi.add_rule',
        timeout: 10,
        retry: 1,
        body: cnapiAddRules
    }, {
        name: 'cnapi.poll_tasks',
        timeout: 120,
        retry: 1,
        body: cnShared.pollTasks
    } ],
    timeout: 210,
    onerror: [ {
        name: 'ufds.delete_rule',
        body: common.delFromUFDS,
        modules: { sdcClients: 'sdc-clients' }
    }, {
        name: 'On error',
        body: function (job, cb) {
            return cb('Error executing job');
        }
    }],

    _set: function (params) {
        cnapiUrl = params.cnapiUrl;
        ufdsDn = params.ufdsDn;
        ufdsPassword = params.ufdsPassword;
        ufdsUrl = params.ufdsUrl;
    }
};
