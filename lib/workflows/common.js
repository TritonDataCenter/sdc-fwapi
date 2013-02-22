/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * FWAPI: shared workflow tasks
 */

// These must match the names available in the workflow VM:
var sdcClients = require('sdc-clients');


// --- Globals



// Make jslint happy:
var ufdsDn;
var ufdsPassword;
var ufdsUrl;



// --- Workflow functions



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



module.exports = {
  delFromUFDS: delFromUFDS
};
