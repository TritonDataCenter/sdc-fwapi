// Copyright 2012 Joyent, Inc.  All rights reserved.

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
    totag: [ 'some-tag' ],
    fromip: [ '1.2.3.4' ],
  };

  var data = fwrule.parseRule({ rule: ruleTxt });
  t.deepEqual(data, expData);

  var rule = new FwRule({ rule: ruleTxt });
  expData['fwrule'] = rule.id;
  expData['objectclass'] = FwRule.objectclass;

  t.deepEqual(rule.raw, expData, 'raw data');

  var serialized = rule.serialize();
  t.deepEqual(serialized, {
    uuid: rule.id,
    enabled: false,
    rule: ruleTxt
  });

  t.end();
});


test('multiple ports', function(t) {
  var inRule = {
    rule: 'FROM ip 10.88.88.1 TO tag tag2 ALLOW tcp (PORT 1002 AND PORT 1052)',
    enabled: true,
    owner_uuid: '00000000-0000-0000-0000-000000000000'
  };

  var expRawData = {
    action: 'allow',
    enabled: true,
    fromip: [ '10.88.88.1' ],
    port: [ 1002, 1052 ],
    protocol: 'tcp',
    totag: [ 'tag2' ],
    user: inRule.owner_uuid
  };

  var rule = new FwRule(inRule);
  expRawData['fwrule'] = rule.id;
  expRawData['objectclass'] = FwRule.objectclass;

  t.deepEqual(rule.raw, expRawData, 'raw data');

  t.deepEqual(rule.serialize(), {
    enabled: true,
    owner_uuid: inRule.owner_uuid,
    // the canonical form of the rule has spaces around the parens:
    rule: 'FROM ip 10.88.88.1 TO tag tag2 ALLOW tcp ( PORT 1002 AND PORT 1052 )',
    uuid: rule.id,
  });

  t.end();
});

