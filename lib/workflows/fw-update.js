/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * FWAPI: update rule workflow
 */

// These must match the names available in the workflow VM:
var async = require('async');
var cnShared = require('wf-shared').cnapi;
var fwShared = require('wf-shared').fwapi;
var sdcClients = require('sdc-clients');
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
  var globalsReq = {
    'CNAPI URL': cnapiUrl,
    'UFDS URL': ufdsUrl,
    'UFDS DN': ufdsDn,
    'UFDS password': ufdsPassword,
  };

  var jobParamsReq = {
    'dn': 'UFDS DN',
    'rule': 'rule',
    'ufdsRaw': 'UFDS raw data'
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
 * Update the rule in UFDS
 */
function updateInUFDS(job, callback) {
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

  var change = {
    operation: 'replace',
    modification: job.params.ufdsRaw
  };

  job.log.debug(change, 'Updating in UFDS: %s', job.params.dn);
  ufds.on('ready', function () {
    return ufds.modify(job.params.dn, change, function (err) {
      if (err) {
        return callback(err);
      }

      return callback(null, 'Updated rule in UFDS');
    });
  });
}



// --- Exports



var workflow = module.exports = {
    name: 'fw-update-' + VERSION,
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
        name: 'ufds.update_rule',
        timeout: 10,
        retry: 1,
        body: updateInUFDS
    }, {
        name: 'cnapi.update_rule',
        timeout: 10,
        retry: 1,
        body: cnShared.fwUpdate
    }, {
        name: 'cnapi.poll_tasks',
        timeout: 120,
        retry: 1,
        body: cnShared.pollTasks
    } ],
    timeout: 210,
    onerror: [ {
        name: 'On error',
        body: function (job, cb) {
          // XXX: rollback in UFDS if necessary
            return cb('Error executing job');
        }
    }]
};
