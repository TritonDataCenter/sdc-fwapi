/*
 * Copyright (c) 2012 Joyent, Inc.  All rights reserved.
 *
 * Main entry-point for the firewall API.
 */

var fwapi = require('./lib/app');
var assert = require('assert-plus');
var bunyan = require('bunyan');
var fs = require('fs');
var restify = require('restify');



//---- Globals



var CONFIG_FILE = __dirname + '/config.json';



//--- Functions



/**
 * Loads the config, throwing an error if the config is incomplete / invalid
 */
function loadConfig(configFile) {
  assert.string(configFile, 'configFile');
  var config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  if (!config.hasOwnProperty('port')) {
    config.port = 80;
  }

  return config;
}


/**
 * Main entry point
 */
function main() {
  var server;
  var log = bunyan.createLogger({
    name: 'fwapi',
    level: 'debug',
    serializers: {
      err: bunyan.stdSerializers.err,
      req: bunyan.stdSerializers.req,
      res: restify.bunyan.serializers.response
    }
  });
  log.info('Loading config file: %s', CONFIG_FILE);
  var config = loadConfig(CONFIG_FILE);
  if (config.hasOwnProperty('logLevel')) {
    log.level(config.logLevel);
  }

  fwapi.create({ config: config, log: log }, function (err, app) {
    if (err) {
      log.error(err, 'Error creating server');
      process.exit(1);
    }

    server = app;
    server.listen(function () {
      var addr = app.server.address();
      log.info('%s listening on <http://%s:%s>',
        app.server.name, addr.address, addr.port);
    });
  });

  // Try to ensure we clean up properly on exit.
  process.on('SIGINT', function _cleanup() {
    log.info('SIGINT: cleaning up');
    if (!server) {
      return process.exit(1);
    }
    log.info('Closing app');
    return server.close(function () {
      process.exit(1);
    });
  });
}

main();
