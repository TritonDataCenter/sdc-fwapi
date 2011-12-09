// Copyright 2011 Joyent, Inc.  All rights reserved.

var sys = require('sys');
var test = require('tap').test;
var fwrule = require('../lib/fwrule');

test('tags', function(t) {
  t.deepEqual(fwrule.parse("FROM ip 1.2.3.4 TO tag some-tag ALLOW tcp port 80"),
    { from: [ { ip: '1.2.3.4' } ],
      to: [ { tag: 'some-tag' } ],
      action: 'allow',
      protocol: 'tcp',
      ports: [ 80 ]
    });

  t.end();
});

