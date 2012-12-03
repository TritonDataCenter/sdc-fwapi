/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * FWAPI: delete rule workflow
 */

var common = require('./common');



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
  var globalsReq = {
    'CNAPI URL': cnapiUrl,
    'UFDS URL': ufdsUrl,
    'UFDS DN': ufdsDn,
    'UFDS password': ufdsPassword,
  };

  var jobParamsReq = {
    'dn': 'UFDS DN',
    'rule': 'rule'
  };

  for (var p in globalsReq) {
    if (!globalsReq[p]) {
      return callback('No ' + globalsReq[p] + ' workflow parameter provided');
    }
  }

  for (var p in jobParamsReq) {
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
  var cnapi = new sdcClients.CNAPI({ url: cnapiUrl });
  job.params.postParams = {
    jobid: job.uuid,
    uuids: [ job.params.rule.uuid ]
  };
  job.params.taskIDs = [];

  async.forEach(job.params.servers, function (uuid, cb) {
    var endpoint = '/servers/' + uuid + '/fw/del';

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

    return callback(null, 'Deleted rules on servers: '
      + job.params.servers.join(', '));
  });
}


/**
 * Delete the rule from UFDS
 */
function delFromUFDS(job, callback) {
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

  job.log.debug('Deleting from UFDS: %s', job.params.dn);
  ufds.on('ready', function () {
    return ufds.del(job.params.dn, function (err) {
      if (err) {
        return callback(err);
      }
      return callback(null, 'Deleted rule from UFDS');
    });
  });
}



// --- Exports



var workflow = module.exports = {
    name: 'del-' + VERSION,
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
        body: common.getVMs
    }, {
        name: 'cnapi.del_rule',
        timeout: 10,
        retry: 1,
        body: cnapiDelRules
    }, {
        name: 'cnapi.poll_tasks',
        timeout: 120,
        retry: 1,
        body: common.cnapiPollTasks
    }, {
        name: 'ufds.del_rule',
        timeout: 10,
        retry: 1,
        body: delFromUFDS
    } ],
    timeout: 210,
    onerror: [ {
        name: 'On error',
        body: function (job, cb) {
            return cb('Error executing job');
        }
    }]
};
