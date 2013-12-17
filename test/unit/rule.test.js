/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for the firewall rule object
 */

var mod_rule = require('../../lib/rule');
var mod_uuid = require('node-uuid');
var util = require('util');
var util_ip = require('../../lib/util/ip');



// --- Helper functions



function subnetNumber(subnet) {
    var split = subnet.split('/');
    return util_ip.aton(split[0]) + '/' + split[1];
}


function rawTag(key, val) {
    if (val === undefined) {
        return util.format('%s==%d', key, key.length);
    } else {
        return util.format('%s=%s=%d', key, val, key.length);
    }
}


// --- Tests



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
        enabled: true,
        global: true
    };

    var rule = mod_rule.create(inRule);
    var raw = {
        fromip: [util_ip.aton(ips[0])],
        fromsubnet: [subnetNumber(subnets[0])],
        fromtag: [ rawTag(tags[0]) ],
        fromvm: [vms[0]],

        toip: [util_ip.aton(ips[1])],
        tosubnet: [subnetNumber(subnets[1])],
        totag: [ rawTag(tags[1]) ],
        tovm: [vms[1]],

        enabled: true,
        objectclass: mod_rule.objectclass,
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
    var rule2 = mod_rule.create(rule.raw());
    t.deepEqual(rule2.raw(), raw, 'rule2.raw()');
    t.deepEqual(rule2.serialize(), inRule, 'rule2.serialize()');
    t.equal(rule2.dn, util.format('uuid=%s, ou=fwrules, o=smartdc', rule.uuid),
        'rule2.dn');

    t.done();
};


exports['owner_uuid'] = function (t) {
    var ip = '10.2.0.3';
    var vm = '9a343ca8-b42a-4a27-a9c5-800f57d1e8ed';

    var inRule = {
        rule: util.format('FROM ip %s TO vm %s ALLOW tcp PORT 25', ip, vm),
        owner_uuid: mod_uuid.v4(),
        enabled: true
    };

    var rule = mod_rule.create(inRule);
    var raw = {
        fromip: [ util_ip.aton(ip) ],
        tovm: [ vm ],
        enabled: true,
        objectclass: mod_rule.objectclass,
        owner: inRule.owner_uuid,
        ports: [ 25 ],
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
    var rule2 = mod_rule.create(rule.raw());
    t.deepEqual(rule2.raw(), raw, 'rule2.raw()');
    t.deepEqual(rule2.serialize(), inRule, 'rule2.serialize()');
    t.equal(rule2.dn, util.format('uuid=%s, ou=fwrules, o=smartdc', rule.uuid),
        'rule2.dn');

    t.done();
};


exports['multiple tags with multiple quoted values'] = function (t) {
    var owner = mod_uuid.v4();
    var rule = mod_rule.create({
        rule: 'FROM (tag "김치" = "백김치" OR '
            + 'tag "김치" = "白김치") TO '
            + '(tag "some tag" = value OR '
            + 'tag some-tag = "another value") ALLOW tcp PORT 80',
        owner_uuid: owner
    });

    var raw = {
        enabled: false,
        objectclass: mod_rule.objectclass,
        ports: [ 80 ],
        action: 'allow',
        owner: owner,
        protocol: 'tcp',
        fromtag: [ rawTag('김치', '白김치'),
            rawTag('김치', '백김치') ],
        totag: [ rawTag('some tag', 'value'),
            rawTag('some-tag', 'another value') ],
        uuid: rule.uuid,
        version: rule.version
    };
    t.deepEqual(rule.raw(), raw, 'rule.raw()');

    var serialized = {
        enabled: false,
        owner_uuid: owner,
        rule: 'FROM (tag "김치" = "白김치" '
            + 'OR tag "김치" = "백김치") TO '
            + '(tag "some tag" = value OR tag some-tag = "another value") '
            + 'ALLOW tcp PORT 80',
        uuid: rule.uuid,
        version: rule.version
    };
    t.deepEqual(rule.serialize(), serialized, 'rule.serialize()');

    t.ok(!rule.allVMs, 'rule.allVMs');

    var ruleTags = [
            [ 'some tag', 'value' ],
            [ 'some-tag', 'another value' ],
            [ '김치', '白김치' ],
            [ '김치', '백김치' ]
    ];
    t.deepEqual(rule.tags, ruleTags, 'rule.tags');

    // Now check that we can reconstruct this data from UFDS
    rule = mod_rule.create(raw);
    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.ok(!rule.allVMs, 'rule.allVMs');
    t.deepEqual(rule.tags, ruleTags, 'rule.tags');

    t.done();
};


exports['global'] = function (t) {
    var caught = false;
    var rule;

    try {
        rule = new mod_rule.Rule({
            rule: 'FROM any TO tag foo=bar BLOCK udp PORT 54',
            owner_uuid: mod_uuid.v4(),
            global: true
        });
    } catch (pErr) {
        caught = true;
    }

    t.ok(caught, 'Error thrown');
    t.ok(!rule, 'No rule');
    t.done();
};
