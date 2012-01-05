// Copyright 2011 Joyent, Inc.  All rights reserved.

var sys = require('sys');
var test = require('tap').test;
var parser = require('../lib/fwrule-parser');
var fwrule = require('../lib/fwrule');
var FwRule = fwrule.FwRule;

test('tags', function(t) {
  var ruleTxt = "FROM ip 1.2.3.4 TO tag some-tag ALLOW tcp PORT 80";
  t.deepEqual(parser.parse(ruleTxt),
    { from: [ [ 'ip', '1.2.3.4' ] ],
      to: [ [ 'tag', 'some-tag' ] ],
      action: 'allow',
      protocol: 'tcp',
      ports: [ 80 ]
    }, 'contains dashes');

  var expData = {
    protocol: 'tcp',
    port: [ 80 ],
    action: 'allow',
    enabled: false,
    to_tag: [ 'some-tag' ],
    from_ip: [ '1.2.3.4' ],
  };

  var data = fwrule.parseRule({ rule: ruleTxt });
  t.deepEqual(data, expData);

  var rule = new FwRule({ rule: ruleTxt });
  expData['fwuuid'] = rule.id;
  expData['objectclass'] = FwRule.objectclass;
  t.deepEqual(rule.raw, expData);

  var serialized = rule.serialize();
  t.deepEqual(serialized, {
    id: rule.id,
    enabled: false,
    rule: ruleTxt
  });

  t.end();
});

