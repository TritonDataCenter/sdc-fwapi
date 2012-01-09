/*
 * Copyright (c) 2011 Joyent, Inc.  All rights reserved.
 *
 * Main entry-point for the firewall API.
 *
 */

var restify = require('restify');
var log = restify.log;
var createApp = require('./lib/app').createApp;
var constants = require('./lib/constants');

// var extraConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
var config = {
  "port": 8080,
  "address": "0.0.0.0",
  "ufds": {
    // XXX: if you put an invalid port here, ldapjs does nothing!?
    "url": "ldaps://localhost:1636",
    "rootDn": "cn=root",
    "password": "secret",
    "caching": true
  },
  dataCenterName: "us-west-1",
  "logLevel": "Debug"
  //"logLevel": "Trace"
};


function main() {
  var theApp;

  createApp(config, function(err, app) {
    if (err) {
      log.error("Error creating app: %s", err);
      process.exit(1);
    }
    theApp = app;
    app.listen(function() {
      var addr = app.server.address();
      log.info(constants.serverName + ' listening on <http://%s:%s>.',
        addr.address, addr.port);
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

