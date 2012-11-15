/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * The Firewall API control application
 */

var assert = require('assert-plus');
var fs = require('fs');
var FWAPI = require('sdc-clients').FWAPI;
var nopt = require('nopt');
var path = require('path');
var tty = require('tty');
var util = require('util');
var verror = require('verror');


//---- Globals



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



// --- Internal helpers



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
    console.error('command-line params: ' + json(params));
  }
  if (errs.length != 0) {
    exit('Invalid parameter%s: %s',
        (errs.length == 1 ? '' : 's'), errs.join(', '));
  }

  return params;
}


/**
 * Prints an error and exits if the UUID is invalid
 */
function validateUUID(arg) {
  if (!arg) {
    console.error('Error: missing UUID');
    process.exit(1);
  }
  if (!UUID_REGEX.test(arg)) {
    console.error('Error: invalid UUID "%s"', arg);
    process.exit(1);
  }
  return arg;
}


/**
 * Pretty-print a JSON object
 */
function json(json) {
  return JSON.stringify(json, null, 2);
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
    'get <rule uuid> user=<user uuid>',
    'update <rule uuid> -f <filename>',
    'delete <rule uuid> user=<user uuid>',
    'ping'
    /*
    'enable <rule uuid> [uuid 2 ...]',
    'disable <rule uuid> [uuid 2 ...]'
    'start <VM uuid>',
    'stop <VM uuid>',
    'status <VM uuid>',
    'rules <VM uuid>'
    */
  ];
  console.log(text.join('\n'));
}


/**
 * Outputs an error to the console, displaying all of the error messages
 * if it's a MultiError
 */
function outputError(err) {
  if (err.hasOwnProperty('ase_errors')) {
    for (var e in err.ase_errors) {
      console.error(err.ase_errors[e].message);
    }
    return;
  }

  return console.error(err.message);
}


/**
 * Outputs one formatted rule line
 */
function ruleLine(r) {
  return util.format('%s %s %s', r.uuid,
    r.enabled ? 'enabled ' : 'disabled', r.rule);
}


/**
 * Reads the payload from one of: a file, stdin, a text argument
 */
function getPayload(opts, callback) {
  if (!opts.file && !tty.isatty(0)) {
    opts.file = '-';
  }

  if (!opts.file) {
    return callback(new verror.VError("Must supply file!"));
  }

  if (opts.file === '-') {
      opts.file = '/dev/stdin';
  }

  fs.readFile(opts.file, function(err, data) {
    if (err) {
      if (err.code === 'ENOENT') {
          return callback(new verror.VError(
            'File "%s" does not exist.', opts.file));
      }
      return callback(new verror.VError(
        'Error reading "%s": %s', opts.file, err.message));
    }

    return callback(null, JSON.parse(data.toString()));
  });
}


/*
 * Generic handler for callbacks: prints out an error if there is one,
 * stringifies the JSON otherwise.
 */
function standardHandler(err, obj, req, res) {
  if (err) {
    var code = '';
    if (VERBOSE) {
      code = err.code + ': ';
      if (!err.code) {
        code = res.statusCode;
      }
      console.error('Status code: %d', res.statusCode);
    }
    return console.error(code + err.message);
  }
  if (VERBOSE) {
    console.log('Status code: %d', res.statusCode);
  }
  return console.log(json(obj));
}



//---- Exports



/**
 * Lists firewall rules
 */
function list(fwapi, opts) {
  var params = getKeyValParams(opts, 1);
  return fwapi.listRules(params, standardHandler);
}


/**
 * Adds a firewall rule
 */
function add(fwapi, opts) {
  getPayload(opts, function (err, payload) {
    if (err) {
      return outputError(err);
    }

    return fwapi.createRule(payload, standardHandler);
  });
}


/**
 * Updates a firewall rule
 */
function update(fwapi, opts) {
  getPayload(opts, function (err, payload) {
    if (err) {
      return outputError(err);
    }

    var id = opts.argv.remain[1] || payload.id;
    if (!id) {
      exit('Error: must supply rule UUID!');
    }
    delete payload.id;

    return fwapi.updateRule(id, payload, standardHandler);
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
  return fwapi.getRule(uuid, params, standardHandler);
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
  return fwapi.deleteRule(uuid, params, standardHandler);
}


/**
 * Ping the API
 */
function ping(fwapi, opts) {
  return fwapi.ping(standardHandler);
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

  var config = JSON.parse(fs.readFileSync(
    path.normalize(__dirname + '/../config.json'), 'utf-8'));
  assert.number(config.port);

  var fwapi = new FWAPI({
    url: 'http://localhost:' + config.port
  });

  switch (command) {
  case 'add':
    add(fwapi, parsedOpts);
    break;
  case 'get':
    get(fwapi, parsedOpts);
    break;
  case 'delete':
    del(fwapi, parsedOpts);
    break;
    /*
  case 'disable':
    enable(parsedOpts, false);
    break;
  case 'enable':
    enable(parsedOpts, true);
    break;
    */
  case 'list':
    list(fwapi, parsedOpts);
    break;
  case 'ping':
    ping(fwapi, parsedOpts);
    break;
  case 'update':
    update(fwapi, parsedOpts);
    break;
    /*
  case 'rules':
    rules(parsedOpts);
    break;
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
