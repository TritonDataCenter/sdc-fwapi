/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Wait for a workflow job
 */

var assert = require('assert-plus');
var sprintf = require('extsprintf').sprintf;
var restify = require('restify');
var util = require('util');



//---- Globals


var IS_TTY = Boolean(process.stdout.isTTY);



//---- Exports




/**
 * Wait for a workflow job to be finished
 */
function waitForWorkflowJob(opts, callback) {
  assert.object(opts, 'opts');
  assert.string(opts.url, 'opts.url');
  assert.optionalBool(opts.printStatus, 'opts.printStatus');

  if (!opts.hasOwnProperty('printStatus')) {
    opts.printStatus = IS_TTY;
  }

  var wfapiClient = restify.createJsonClient({ url: opts.url });
  var endpoint = util.format('/jobs/%s', opts.uuid);
  var intervalID;
  var numPrinted = 0;
  var chainNames = [];
  var chainTotal = 0;
  var outputLine = '';
  var timeout = 20;
  var startTime = Date.now(0);

  function interval() {
    return wfapiClient.get(endpoint, function (err, req, res, job) {
      if (err) {
        if (intervalID) {
          clearInterval(intervalID);
        }

        return callback(err);
      }

      // The job should know best what a reasonable timeout is:
      if (chainTotal === 0 && job.hasOwnProperty('timeout')) {
          timeout = job.timeout;
      }

      if (opts.printStatus) {
        // Initial time through this loop: figure out the maximum length of
        // fields that we're going to print
        if (chainTotal === 0) {
          var maxNameLen = 1;
          chainTotal = job.chain.length;
          job.chain.forEach(function (c) {
            if (c.name.length > maxNameLen) {
              maxNameLen = c.name.length;
            }
            chainNames.push(c.name);
          });

          outputLine = '%3d%% %' + maxNameLen + 's: %s';
        }

        while (numPrinted < job.chain_results.length) {
          var curRes = job.chain_results[numPrinted];
          var msg = curRes.result;
          if (curRes.error) {
            msg = curRes.error;
            if (typeof (curRes.error) === 'object') {
              msg = curRes.error.message;
            }
          }

          var name = curRes.name || chainNames[numPrinted];
          console.log(sprintf(outputLine,
            Math.floor((numPrinted / chainTotal) * 100), name, msg));
          numPrinted++;
        }
      }

      if (job.execution == 'succeeded' || job.execution == 'failed') {
        if (intervalID) {
          clearInterval(intervalID);
        }

        if (opts.printStatus) {
          console.log('result: %s', job.execution);
        }
        return callback(null, job);
      }

      if ((Date.now(0) - startTime) / 1000 > timeout) {
        if (intervalID) {
          clearInterval(intervalID);
        }
        var timeoutErr = new Error('timeout');
        timeoutErr.code = 'timeout';
        return callback(timeoutErr, job);
      }

      if (!intervalID) {
        intervalID = setInterval(interval, 1000);
      }
    });
  }

  interval();
}



module.exports = {
  waitForJob: waitForWorkflowJob
};
