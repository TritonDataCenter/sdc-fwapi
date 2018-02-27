/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Tests for creating invalid rules.
 */

'use strict';

var test = require('tape');
var mod_err = require('../../lib/errors');
var mod_rule = require('../lib/rule');
var mod_uuid = require('uuid');


// --- Globals

var OWNER = mod_uuid.v4();


// --- Helpers


function createPayload(ruleTxt) {
    return {
        owner_uuid: OWNER,
        enabled: true,
        rule: ruleTxt
    };
}


// --- Tests

[
    [ 'missing owner_uuid',
      { rule: 'FROM tag a TO tag b ALLOW udp port 53', enabled: true },
      [ mod_err.invalidParam('owner_uuid', 'owner_uuid required') ] ],

    [ 'bad enabled value',
      {
          rule: 'FROM tag a TO tag b ALLOW udp port 53',
          owner_uuid: OWNER,
          enabled: 'hello'
      },
      [ mod_err.invalidParam('enabled', 'enabled must be true or false') ] ],

    [ 'bad global value',
      {
          rule: 'FROM tag a TO tag b ALLOW udp port 53',
          enabled: true,
          global: 'foobar'
      },
      [ mod_err.invalidParam('global', 'global must be true or false') ] ],

    [ 'bad IPv4 subnet: bits to right of mask',
      createPayload('FROM tag foo TO subnet 10.8.0.0/5 ALLOW udp port 53'),
      [ mod_err.invalidParam('rule',
          'Subnet "10.8.0.0/5" is invalid (bits set to right of mask)') ] ],

    [ 'bad IPv6 subnet: bits to right of mask',
      createPayload('FROM tag foo TO subnet fd00::/2 ALLOW udp port 53'),
      [ mod_err.invalidParam('rule',
          'Subnet "fd00::/2" is invalid (bits set to right of mask)') ] ],

    [ 'invalid port: too small',
      createPayload('FROM tag foo TO subnet 10.8.0.0/24 ALLOW udp port 0'),
      [ mod_err.invalidParam('rule', 'Port number "0" is invalid') ] ],

    [ 'invalid port: too big',
      createPayload('FROM tag foo TO subnet 10.8.0.0/24 ALLOW udp port 65537'),
      [ mod_err.invalidParam('rule', 'Port number "65537" is invalid') ] ],

    [ 'rule: bad ip target for ICMPv4',
      createPayload('FROM all vms TO ip fd00::45 BLOCK ICMP TYPE 8'),
      [ mod_err.invalidParam('rule',
          'rule affects ICMPv4 but contains a non-IPv4 address') ] ],

    [ 'rule: bad subnet target for ICMPv4',
      createPayload('FROM all vms TO subnet fe80::/64 BLOCK ICMP TYPE 8'),
      [ mod_err.invalidParam('rule',
          'rule affects ICMPv4 but contains a non-IPv4 subnet') ] ],

    [ 'rule: bad ip target for ICMPv6',
      createPayload('FROM all vms TO ip 1.2.3.4 BLOCK ICMP6 TYPE 128'),
      [ mod_err.invalidParam('rule',
          'rule affects ICMPv6 but contains a non-IPv6 address') ] ],

    [ 'rule: bad subnet target for ICMPv6',
      createPayload('FROM all vms TO subnet 10.0.0.0/8 BLOCK ICMP6 TYPE 128'),
      [ mod_err.invalidParam('rule',
          'rule affects ICMPv6 but contains a non-IPv6 subnet') ] ],

    [ 'rule: bad ICMP type',
      createPayload('FROM all vms TO ip 192.168.5.4 BLOCK ICMP TYPE 260'),
      [ mod_err.invalidParam('rule', 'ICMP type "260" is invalid') ] ]
].forEach(function (cfg) {
    test('Invalid rule: ' + cfg[0], function (t) {
        mod_rule.create(t, {
            rule: cfg[1],
            expCode: 422,
            expErr: {
                code: 'InvalidParameters',
                message: 'Invalid parameters',
                errors: cfg[2]
            }
        });
    });
});



// --- Teardown


test('Cleanup any created rules', mod_rule.delAllCreated);
