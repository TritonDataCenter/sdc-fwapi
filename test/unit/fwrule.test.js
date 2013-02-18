/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for the firewall rule object
 */

var fwrule = require('../../lib/fwrule');
var util = require('util');
var util_ip = require('../../lib/util/ip');


function subnetNumber(subnet) {
  var split = subnet.split('/');
  return util_ip.aton(split[0]) + '/' + split[1];
}


exports['all target types'] = function (t) {
  var ips = ['192.168.1.1', '10.2.0.3'];
  var vms = ['9a343ca8-b42a-4a27-a9c5-800f57d1e8ed',
    '518908b6-8299-466d-8ea5-20a0ceff63ec'];
  var tags = ['tag1', 'tag2'];
  var subnets = ['192.168.2.0/24', '10.2.1.0/24'];

  var inRule = {
    rule: util.format('FROM (ip %s OR subnet %s OR tag %s OR vm %s) ',
      ips[0], subnets[0], tags[0], vms[0])
      + util.format('TO (ip %s OR subnet %s OR tag %s OR vm %s)',
      ips[1], subnets[1], tags[1], vms[1])
      + ' ALLOW tcp (PORT 80 AND PORT 81)',
    enabled: true
  }

  var rule = fwrule.create(inRule);
  var raw = {
    fromip: [util_ip.aton(ips[0])],
    fromsubnet: [subnetNumber(subnets[0])],
    fromtag: [tags[0]],
    fromvm: [vms[0]],

    toip: [util_ip.aton(ips[1])],
    tosubnet: [subnetNumber(subnets[1])],
    totag: [tags[1]],
    tovm: [vms[1]],

    enabled: true,
    objectclass: fwrule.objectclass,
    ports: [ 80, 81 ],
    action: 'allow',
    protocol: 'tcp',
    uuid: rule.uuid,
    version: rule.version
  };

  inRule.uuid = rule.uuid;
  inRule.version = rule.version;

  t.deepEqual(rule.raw(), raw, 'rule.raw()');
  t.deepEqual(rule.serialize(), inRule, 'rule.serialize()');
  t.equal(rule.dn, util.format('uuid=%s, ou=fwrules, o=smartdc', rule.uuid),
    'rule.dn');

  // Now recreate the rule from the raw UFDS data
  var rule2 = fwrule.create(rule.raw());
  t.deepEqual(rule2.raw(), raw, 'rule2.raw()');
  t.deepEqual(rule2.serialize(), inRule, 'rule2.serialize()');
  t.equal(rule2.dn, util.format('uuid=%s, ou=fwrules, o=smartdc', rule.uuid),
    'rule2.dn');

  t.done();
};
