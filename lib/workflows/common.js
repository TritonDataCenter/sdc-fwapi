/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * FWAPI: workflow shared functions
 */

// These must match the names available in the workflow VM:
var async = require('async');
var restify = require('restify');
var sdcClients = require('sdc-clients');



// --- Globals



// Make jslint happy:
var cnapiUrl;
var vmapiUrl;



// --- Exports



/**
 * Poll CNAPI for each of the server tasks sent off
 */
function cnapiPollTasks(job, callback) {
  var cnapi = new sdcClients.CNAPI({ url: cnapiUrl });

  job.params.taskSuccesses = [];
  job.params.taskFailures = [];

  async.forEach(job.params.taskIDs, function (detail, cb) {
    var uuid = detail.server_uuid;
    var taskID = detail.task_id;
    var intervalID = setInterval(interval, 1000);

    function interval() {
      cnapi.getTask(taskID, function onCnapi(err, task) {
        if (err) {
          clearInterval(intervalID);
          return cb(err);
        }

        job.log.debug(task, 'retrieved task for server "%s"', uuid);
        if (task.status == 'failure') {
          clearInterval(intervalID);
          job.params.taskFailures.push(taskID);
          return cb(new verror.VError(
            'Job "%s" failed for server "%s"', taskID, uuid));

        } if (task.status == 'complete') {
          clearInterval(intervalID);
          job.params.taskSuccesses.push(taskID);
          return cb(null);
        }
      });
    }
  }, function (err) {
    if (err) {
      return callback(err);
    }

    return callback(null, 'All server tasks returned successfully');
  });
}


/**
 * Get VMs from VMAPI
 *
 * @param job {Object} :
 * - params {Object} : must specify at least one of tags, vms:
 *   - tags {Array} : tag names to search for
 *   - vms {Array} : VM UUIDs to search for
 * @param callback {Function} : `f(err, successMessage)`
 *
 * Once function is complete, the following will be stored in job.params:
 * - ipData {Object} :
 *   - machines {Object} : mapping of machines to IP addresses
 *   - tags {Object} : mapping of tags to IP addresses
 * - servers {Array} : server UUIDs that contain the matching VMs
 */
function getVMs(job, callback) {
  if (!job.params.hasOwnProperty('tags') && !job.params.hasOwnProperty('vms')) {
    return callback(null, 'No tags or VMs to get');
  }
  var tags = job.params.tags || [];
  var vms = job.params.vms || [];
  var left = {
    tags: tags.reduce(function (acc, t) { acc[t] = 1; return acc }, {}),
    vms:  vms.reduce(function (acc, vm) { acc[vm] = 1; return acc }, {})
  };

  //var vmapi = new sdcClients.VMAPI(vmapiOptions);
  var vmapi = restify.createJsonClient({ url: vmapiUrl });
  return vmapi.get('/vms', function (err, req, res, vmList) {
    if (err) {
      return callback(err);
    }

    var ipData = {
      machines: {},
      tags: {}
    };
    var servers = {};

    vmList.forEach(function (vm) {
      var ips = vm.nics.map(function (n) { return n.ip; });
      tags.forEach(function (tag) {
        if (vm.tags.hasOwnProperty(tag)) {
          if (!ipData.tags.hasOwnProperty(tag)) {
            ipData.tags[tag] = {};
          }

          ips.forEach(function (ip) {
            ipData.tags[tag][ip] = 1;
          });

          servers[vm.server_uuid] = 1;
          delete left.tags[tag];
        }
      });

      vms.forEach(function (uuid) {
        if (vm.uuid == uuid) {
          if (!ipData.machines.hasOwnProperty(uuid)) {
            ipData.machines[uuid] = {};
          }

          ips.forEach(function (ip) {
            ipData.machines[uuid][ip] = 1;
          });

          servers[vm.server_uuid] = 1;
          delete left.vms[uuid];
        }
      });
    });

    var errs = [];
    var vmsLeft = Object.keys(left.vms);
    var tagsLeft = Object.keys(left.tags);

    if (tagsLeft.length !== 0) {
      errs.push(new verror.VError('Unknown tag%s: %s',
        tagsLeft.length == 0 ? '' : 's',
        tagsLeft.join(', ')));
    }
    if (vmsLeft.length !== 0) {
      errs.push(new verror.VError('Unknown VM%s: %s',
        vmsLeft.length == 0 ? '' : 's',
        vmsLeft.join(', ')));
    }

    if (errs.length !== 0) {
      return callback(new verror.MultiError(errs));
    }

    for (var m in ipData.machines) {
      ipData.machines[m] = Object.keys(ipData.machines);
    }
    for (var t in ipData.machines) {
      ipData.tags[t] = Object.keys(ipData.tags);
    }

    job.params.ipData = ipData;
    job.params.servers = Object.keys(servers);

    job.log.info({ ips: ipData, servers: job.params.servers },
      'firewall VM data retrieved');
    return callback(null, 'firewall VM data retrieved');
  });
}



module.exports = {
  cnapiPollTasks: cnapiPollTasks,
  getVMs: getVMs
};
