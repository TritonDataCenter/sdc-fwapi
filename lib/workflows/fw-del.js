/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * FWAPI: delete rule workflow
 */

var async = require('async');
var common = require('./common');
var cnShared = require('wf-shared').cnapi;
var fwShared = require('wf-shared').fwapi;
var sdcClients = require('sdc-clients');



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
        'rule_uuid': 'rule UUID'
    };

    for (p in globalsReq) {
        if (!globalsReq[p]) {
            return callback('No ' + globalsReq[p]
                + ' workflow parameter provided');
        }
    }

    for (p in jobParamsReq) {
        if (!job.params[p]) {
            return callback('No ' + jobParamsReq[p] + ' parameter provided');
        }
    }

    return callback(null, 'parameters validated successfully');
}


/**
 * Start a provisioner task with CNAPI on each of the servers to delete
 * the rules
 */
function cnapiDelRules(job, callback) {
    if (!job.params.fwapiServers || job.params.fwapiServers.length === 0) {
        return callback(null, 'No servers with rules: not adding CNAPI tasks');
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
    job.params.postParams = {
        jobid: job.uuid,
        uuids: [ job.params.rule_uuid ]
    };
    job.params.taskIDs = [];

    async.forEach(job.params.fwapiServers, function (uuid, cb) {
        var endpoint = '/servers/' + uuid + '/fw/del';

        if (servers.hasOwnProperty(uuid) &&
            servers[uuid].hasOwnProperty('sysinfo') &&
            !servers[uuid].sysinfo.hasOwnProperty('SDC Version')) {
            job.log.info('server %s is 6.5: not sending delete tasks', uuid);
            return cb();
        }

        serversSent.push(uuid);

        job.log.debug('Deleting rules from server "%s"', uuid);
        return cnapi.post(endpoint, job.params.postParams,
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
                'Only 6.5 servers available: did not send delete tasks');
        }

        return callback(null, 'Started delete task on servers: '
            + serversSent.join(', '));
    });
}



// --- Exports



var workflow = module.exports = {
    name: 'fw-del-' + VERSION,
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
        name: 'cnapi.get_server_sysinfos',
        timeout: 10,
        retry: 1,
        body: cnShared.sysinfoList
    }, {
        name: 'cnapi.del_rule',
        timeout: 10,
        retry: 1,
        body: cnapiDelRules
    }, {
        name: 'cnapi.poll_tasks',
        timeout: 120,
        retry: 1,
        body: cnShared.pollTasks
    }, {
        name: 'ufds.del_rule',
        timeout: 10,
        retry: 1,
        body: common.delFromUFDS
    } ],
    timeout: 210,
    onerror: [ {
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
