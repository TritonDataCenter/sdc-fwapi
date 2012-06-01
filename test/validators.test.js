// Copyright 2012 Joyent, Inc.  All rights reserved.

var sys = require('sys');
var test = require('tap').test;
var validator = require('../lib/fwrule-parser/validators.js');

test('IPv4 addresses', function(t) {
  var valid = [
    '1.2.3.4',
    '1.0.0.0',
    '01.02.03.04'
  ];
  for (var i in valid) {
    t.ok(validator.validateIPv4address(valid[i]), valid[i]);
  }

  var invalid = [
    '1',
    'asdf',
    '0.0.0.0',
    '255.255.255.255',
    '256.0.0.1'
  ];
  for (var i in invalid) {
    t.notOk(validator.validateIPv4address(invalid[i]), invalid[i]);
  }

  t.end();
});

test('IPv4 subnets', function(t) {
  var valid = [
    '1.2.3.4/24',
    '1.0.0.0/32',
    '01.02.03.04/24',
    '10.88.88.24/32',
    '10.88.88.24/1',
  ];
  for (var i in valid) {
    t.ok(validator.validateIPv4subnet(valid[i]), valid[i]);
  }

  var invalid = [
    '1',
    'asdf',
    '0.0.0.0/32',
    '1.0.0.0/33',
    '1.0.0.0/0'
  ];
  for (var i in valid) {
    t.notOk(validator.validateIPv4subnet(invalid[i]), invalid[i]);
  }

  t.end();
});
