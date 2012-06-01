/*
 * Copyright (c) 2011 Joyent, Inc.  All rights reserved.
 *
 * Main entry-point for the firewall API.
 *
 */

var bunyan = require('bunyan');
var restify = require('restify');

var createApp = require('./lib/app').createApp;
var constants = require('./lib/constants');

// var extraConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
var config = {
  "port": 8080,
  "address": "0.0.0.0",
  "ufds": {
    // XXX: if you put an invalid port here, ldapjs does nothing!?
    "url": "ldaps://10.99.99.13:636",
    "rootDn": "cn=root",
    "password": "secret",
    "caching": true
  },
  "mapi": {
    "username": "admin",
    "password": "tot@ls3crit",
    "uri": "http://10.99.99.8:80"
  },
  dataCenterName: "us-west-1",
  "logLevel": "Debug"
  //"logLevel": "Trace"
};


function main() {
  var theApp;
  var log = bunyan.createLogger({
      name: 'fwapi',
      level: 'debug',
      serializers: {
          err: bunyan.stdSerializers.err,
          req: bunyan.stdSerializers.req,
          res: restify.bunyan.serializers.response
      }
  });

  createApp({ config: config, log: log }, function(err, app) {
    if (err) {
      log.error(err, "Error creating app");
      process.exit(1);
    }
    theApp = app;
    app.listen(function() {
      var addr = app.server.address();
      log.info('%s listening on <http://%s:%s>.',
        constants.serverName, addr.address, addr.port);
    });
  });

  // Try to ensure we clean up properly on exit.
  function closeApp(callback) {
    if (theApp) {
      log.info("Closing app.");
      theApp.close(callback);
    } else {
      log.debug("No app to close.");
      callback();
    }
  }
  process.on("SIGINT", function() {
    log.debug("SIGINT. Cleaning up.")
    closeApp(function () {
      process.exit(1);
    });
  });
}

main();

