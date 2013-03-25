/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * The Firewall API control application
 */

var assert = require('assert-plus');
var cli = require('./cli');
var fs = require('fs');
var FWAPI = require('sdc-clients').FWAPI;
var nopt = require('nopt');
var path = require('path');
var util = require('util');
var workflow = require('./util/workflow');



//---- Globals



var CONFIG;
var DEBUG = false;
var LONG_OPTS = {
  'dryrun': Boolean,
  'file': path,
  'json': Boolean,
  'stdout': Boolean,
  'verbose': Boolean
};
var SHORT_OPTS = {
  'f': '--file',
  'j': '--json',
  'v': '--verbose'
};
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var VERBOSE = false;
var WAIT = true;



// --- Internal helpers



/*
 * Exits with a message.
 */
function exit() {
  console.error.apply(null, Array.prototype.slice.apply(arguments));
  process.exit(1);
}


/*
 * Parses params in argv for key=val parameters, and returns them as a hash.
 */
function getKeyValParams(opts, idx) {
  var params = {};
  var errs = [];
  if (!idx) {
    idx = 0;
  }

  for (var i = idx; i < opts.argv.remain.length; i++) {
    var split = opts.argv.remain[i].split('=');
    if (split.length != 2) {
      errs.push(opts.argv.remain[i]);
      continue;
    }
    params[split[0]] = split[1];
  }

  if (DEBUG) {
    console.error('command-line params: ' + cli.json(params));
  }
  if (errs.length != 0) {
    exit('Invalid parameter%s: %s',
        (errs.length == 1 ? '' : 's'), errs.join(', '));
  }

  return params;
}


/**
 * Program usage
 */
function usage() {
  var text = [
    'Usage: fwapi <command> [options]',
    '',
    'Commands:',
    '',
    'list',
    'add -f <filename>',
    'get <rule uuid>',
    'update <rule uuid> -f <filename>',
    'enable <rule uuid>',
    'disable <rule uuid>',
    'delete <rule uuid>',
    'resolve -f <filename>',
    'rules <VM uuid>',
    'vms <rule uuid>',
    'ping',
    'log',
    'lastlog',
    'tail'
    /*
    'start <VM uuid>',
    'stop <VM uuid>',
    'status <VM uuid>',
    */
  ];
  console.log(text.join('\n'));
}


/*
 * Generic handler for callbacks: prints out an error if there is one,
 * stringifies the JSON otherwise.
 */
function standardHandler(opts, err, obj, req, res) {
  if (err) {
    return cli.exitWithErr(err, opts);
  }

  if (VERBOSE) {
    console.log('Status code: %d', res.statusCode);
  }

  if (!WAIT || !obj.hasOwnProperty('job_uuid') ||
      !CONFIG.hasOwnProperty('wfapi')) {
    return console.log(cli.json(obj));
  }

  if (VERBOSE) {
    console.log('Job UUID: %s', obj.job_uuid);
  }

  var waitOpts = {
    url: CONFIG.wfapi.url,
    uuid: obj.job_uuid,
  };

  workflow.waitForJob(waitOpts, function (err, res2) {
    if (err) {
      if (res2 && res2.chain_results) {
        console.log(cli.json(res2.chain_results));
      }

      return cli.exitWithErr(err, opts);
    }

    if (VERBOSE || opts.json) {
      console.log(cli.json(res2.chain_results));
    }

    if (obj.rule) {
      return console.log(cli.json(obj.rule));
    }
  });
}



//---- Exports



/**
 * Lists firewall rules
 */
function list(fwapi, opts) {
  var params = getKeyValParams(opts, 1);
  return fwapi.listRules(params, standardHandler.bind(null, opts));
}


/**
 * Adds a firewall rule
 */
function add(fwapi, opts) {
  cli.getPayload(opts, function (err, payload) {
    if (err) {
      return cli.exitWithErr(err);
    }

    return fwapi.createRule(payload, standardHandler.bind(null, opts));
  });
}


/**
 * Enables or disables a firewall rule according to state
 */
function enable(fwapi, opts, state) {
  var id = opts.argv.remain[1];
  if (!id) {
    exit('Error: must supply rule UUID!');
  }

  return fwapi.updateRule(id, { enabled: state },
    standardHandler.bind(null, opts));
}


/**
 * Updates a firewall rule
 */
function update(fwapi, opts) {
  cli.getPayload(opts, function (err, payload) {
    if (err) {
      return cli.exitWithErr(err, opts);
    }

    var id = opts.argv.remain[1] || payload.id;
    if (!id) {
      exit('Error: must supply rule UUID!');
    }
    delete payload.id;

    return fwapi.updateRule(id, payload, standardHandler.bind(null, opts));
  });
}


/**
 * Gets a firewall
 */
function get(fwapi, opts) {
  var uuid = opts.argv.remain[1];
  if (!uuid) {
    exit('Error: must supply rule UUID!');
  }
  var params = getKeyValParams(opts, 2);
  return fwapi.getRule(uuid, params, standardHandler.bind(null, opts));
}


/**
 * Deletes a firewall rule
 */
function del(fwapi, opts) {
  var uuid = opts.argv.remain[1];
  if (!uuid) {
    exit('Error: must supply rule UUID!');
  }
  var params = getKeyValParams(opts, 2);
  return fwapi.deleteRule(uuid, params, standardHandler.bind(null, opts));
}


/**
 * Ping the API
 */
function ping(fwapi, opts) {
  return fwapi.ping(standardHandler.bind(null, opts));
}


/**
 * Lists rules that affect a VM
 */
function rules(fwapi, opts) {
  var uuid = opts.argv.remain[1];
  if (!uuid) {
    exit('Error: must supply VM UUID!');
  }
  var params = getKeyValParams(opts, 2);
  return fwapi.getVMrules(uuid, params, standardHandler.bind(null, opts));
}


/**
 * Lists VMs affected by a rule
 */
function vms(fwapi, opts) {
  var uuid = opts.argv.remain[1];
  if (!uuid) {
    exit('Error: must supply rule UUID!');
  }
  var params = getKeyValParams(opts, 2);
  return fwapi.getRuleVMs(uuid, params, standardHandler.bind(null, opts));
}


/**
 * Resolve targets into rules
 */
function resolve(fwapi, opts) {
  cli.getPayload(opts, function (err, payload) {
    if (err) {
      return cli.exitWithErr(err, opts);
    }

    return fwapi.post('/resolve', payload, standardHandler.bind(null, opts));
  });
}


/**
 * Main entry point
 */
function main() {
  var parsedOpts = nopt(LONG_OPTS, SHORT_OPTS, process.argv, 2);
  var command = parsedOpts.argv.remain[0];

  if (parsedOpts.verbose)
    VERBOSE = true;
  if (parsedOpts.debug)
    DEBUG = true;

  CONFIG = JSON.parse(fs.readFileSync(
    path.normalize(__dirname + '/../config.json'), 'utf-8'));
  assert.number(CONFIG.port);

  var fwapi = new FWAPI({
    agent: false,
    url: 'http://localhost:' + CONFIG.port
  });

  switch (command) {
  case 'add':
    add(fwapi, parsedOpts);
    break;
  case 'get':
    get(fwapi, parsedOpts);
    break;
  case 'del':
  case 'delete':
    del(fwapi, parsedOpts);
    break;
  case 'disable':
    enable(fwapi, parsedOpts, false);
    break;
  case 'enable':
    enable(fwapi, parsedOpts, true);
    break;
  case 'list':
    list(fwapi, parsedOpts);
    break;
  case 'ping':
    ping(fwapi, parsedOpts);
    break;
  case 'resolve':
    resolve(fwapi, parsedOpts);
    break;
  case 'rules':
    rules(fwapi, parsedOpts);
    break;
  case 'update':
    update(fwapi, parsedOpts);
    break;
  case 'vms':
    vms(fwapi, parsedOpts);
    break;
    /*
  case 'start':
    start(parsedOpts);
    break;
  case 'status':
    status(parsedOpts);
    break;
  case 'stop':
    stop(parsedOpts);
    break;
    */
  default:
    usage();
    break;
  }
}


main();
