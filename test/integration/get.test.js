/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Integration tests for getting rules
 */

'use strict';

var test = require('tape');
var mod_rule = require('../lib/rule');
var mod_uuid = require('uuid');



// --- Globals



var OWNERS = [
    mod_uuid.v4(),
    mod_uuid.v4(),
    mod_uuid.v4()
];
var VM_UUIDS = [
    mod_uuid.v4(),
    mod_uuid.v4()
];

var RULES = [
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM any TO all vms ALLOW tcp PORT 5000'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[1],
        rule: 'FROM (tag "foo" = "bar" OR tag "foo" = "baz") '
            + 'TO tag "side" = "two" ALLOW tcp (PORT 5003 AND PORT 5004)'
    },
    {
        enabled: true,
        global: true,
        rule: 'FROM any TO tag "foo" = "baz" ALLOW tcp PORT 5010'
    },

    /* IP rule, VM rule, subnet rule */
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM ip 8.8.8.8 TO tag "foo" = "baz" ALLOW tcp PORT 5010'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM ip 4.4.4.4 TO tag "foo" = "baz" ALLOW tcp PORT 5010'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM subnet 10.8.0.0/16 TO tag "foo" = "baz" ALLOW tcp PORT 5010'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM subnet 10.7.0.0/16 TO tag "foo" = "baz" ALLOW tcp PORT 5010'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM vm ' + VM_UUIDS[0] +
            ' TO tag "foo" = "baz" ALLOW tcp PORT 5010'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[0],
        rule: 'FROM vm ' + VM_UUIDS[1] +
            ' TO tag "foo" = "baz" ALLOW tcp PORT 5010'
    },

    /* FWRULE_VERSION 4 features */
    {
        enabled: true,
        owner_uuid: OWNERS[2],
        rule: 'FROM tag "a" TO tag "b" ALLOW tcp PORT 80 PRIORITY 50'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[2],
        rule: 'FROM tag "a" TO tag "b" ALLOW ah'
    },
    {
        enabled: true,
        owner_uuid: OWNERS[2],
        rule: 'FROM tag "a" TO tag "b" ALLOW esp'
    }
];

var PRE_EXISTING_GLOBALS = [];


// --- Tests


// Get the pre-existing globals
test('get: global rules', function (t) {
    mod_rule.list(t, {
        params: {
            global: true
        }
    }, function (_, res) {
        PRE_EXISTING_GLOBALS = res;
        PRE_EXISTING_GLOBALS.push(RULES[2]);
        t.end();
    });
});

test('add all rules', function (t) {
    mod_rule.createAndGetN(t, {
        rules: RULES
    });
});


test('get: owner rule with owner_uuid', function (t) {
    mod_rule.get(t, {
        uuid: RULES[0].uuid,
        params: {
            owner_uuid: RULES[0].owner_uuid
        },
        exp: RULES[0]
    });
});


test('get: owner rule with wrong owner_uuid', function (t) {
    mod_rule.get(t, {
        uuid: RULES[0].uuid,
        params: {
            owner_uuid: OWNERS[1]
        },
        expCode: 403,
        expErr: {
            code: 'Forbidden',
            message: 'owner does not match',
            errors: [ {
                field: 'owner_uuid',
                code: 'InvalidParameter',
                message: 'owner_uuid does not match'
            } ]
        }
    });
});

test('get: owner rule with misformatted uuid', function (t) {
    mod_rule.list(t, {
        params: {
            owner_uuid: 'not-a-uuid'
        },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'owner_uuid',
                code: 'InvalidParameter',
                invalid: [ 'not-a-uuid' ],
                message: 'invalid UUID'
            } ]
        }
    });
});

test('get: ip rule with misformatted ip', function (t) {
    mod_rule.list(t, {
        params: {
            ip: 'not-an-ip'
        },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'ip',
                code: 'InvalidParameter',
                invalid: [ 'not-an-ip' ],
                message: 'invalid IP'
            } ]
        }
    });
});

test('get: ip rule with non-string value', function (t) {
    mod_rule.list(t, {
        params: { ip: 42 },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'ip',
                code: 'InvalidParameter',
                invalid: [ '42' ],
                message: 'invalid IP'
            } ]
        }
    });
});

test('get: ip rule with non-string values', function (t) {
    mod_rule.list(t, {
        params: { ip: [42, {}] },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'ip',
                code: 'InvalidParameter',
                invalid: [ '', '42' ],
                message: 'invalid IPs'
            } ]
        }
    });
});

test('get: ip rule with valid ip', function (t) {
    mod_rule.list(t, {
        params: { ip: '8.8.8.8', owner_uuid: RULES[3].owner_uuid },
        expCode: 200,
        exp: [ RULES[3] ]
    });
});

test('get: ip rule with valid ips', function (t) {
    mod_rule.list(t, {
        params: { ip: ['8.8.8.8', '4.4.4.4'], owner_uuid: RULES[3].owner_uuid },
        expCode: 200,
        exp: [ RULES[3], RULES[4] ]
    });
});

test('get: vm rule with misformatted vm', function (t) {
    mod_rule.list(t, {
        params: {
            vm: 'not-a-vm'
        },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'vm',
                code: 'InvalidParameter',
                invalid: [ 'not-a-vm' ],
                message: 'invalid UUID'
            } ]
        }
    });
});

test('get: vm rule with non-string value', function (t) {
    mod_rule.list(t, {
        params: { vm: 42 },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'vm',
                code: 'InvalidParameter',
                invalid: [ '42' ],
                message: 'invalid UUID'
            } ]
        }
    });
});

test('get: vm rule with non-string values', function (t) {
    mod_rule.list(t, {
        params: { vm: [42, {}] },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'vm',
                code: 'InvalidParameter',
                invalid: [ '', '42' ],
                message: 'invalid UUID'
            } ]
        }
    });
});

test('get: vm rule with valid vm', function (t) {
    mod_rule.list(t, {
        params: { vm: VM_UUIDS[0], owner_uuid: RULES[7].owner_uuid },
        expCode: 200,
        exp: [ RULES[7] ]
    });
});

test('get: vm rule with valid vms', function (t) {
    mod_rule.list(t, {
        params: { vm: [VM_UUIDS[0], VM_UUIDS[1]] },
        expCode: 200,
        exp: [RULES[7], RULES[8] ]
    });
});

test('get: subnet rule with misformatted subnet', function (t) {
    mod_rule.list(t, {
        params: {
            subnet: 'not-a-subnet'
        },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'subnet',
                code: 'InvalidParameter',
                invalid: [ 'not-a-subnet' ],
                message: 'Subnet must be in CIDR form'
            } ]
        }
    });
});

test('get: subnet rule with non-string value', function (t) {
    mod_rule.list(t, {
        params: { subnet: 42 },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'subnet',
                code: 'InvalidParameter',
                invalid: [ '42' ],
                message: 'Subnet must be in CIDR form'
            } ]
        }
    });
});

test('get: subnet rule with non-string values', function (t) {
    mod_rule.list(t, {
        params: { subnet: [42, {}] },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'subnet',
                code: 'InvalidParameter',
                invalid: [ '', '42' ],
                message: 'Subnet must be in CIDR form'
            } ]
        }
    });
});

test('get: subnet rule with valid subnet', function (t) {
    mod_rule.list(t, {
        params: { subnet: '10.8.0.0/16', owner_uuid: RULES[5].owner_uuid },
        expCode: 200,
        exp: [ RULES[5] ]
    });
});

test('get: subnet rule with valid subnets', function (t) {
    mod_rule.list(t, {
        params: { subnet: [ '10.8.0.0/16', '10.7.0.0/16'],
                  owner_uuid: RULES[5].owner_uuid },
        expCode: 200,
        exp: [ RULES[5], RULES[6] ]
    });
});

test('get: global rule with no params', function (t) {
    mod_rule.get(t, {
        uuid: RULES[2].uuid,
        exp: RULES[2]
    });
});

test('get: enabled rule owner0', function (t) {
    mod_rule.list(t, {
        params: { enabled: true, owner_uuid: RULES[0].owner_uuid },
        expCode: 200,
        exp: [ RULES[0] ].concat(RULES.slice(3, 9))
    });
});

test('get: enabled rule owner1', function (t) {
    mod_rule.list(t, {
        params: { enabled: true, owner_uuid: RULES[1].owner_uuid },
        expCode: 200,
        exp: [ RULES[1] ]
    });
});

test('get: enabled rule without bool', function (t) {
    mod_rule.list(t, {
        params: { enabled: 'foobar' },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'enabled',
                code: 'InvalidParameter',
                message: 'must be a boolean value'
            } ]
        }
    });
});

test('get: action rule allow owner0', function (t) {
    mod_rule.list(t, {
        params: { action: 'allow', owner_uuid: RULES[0].owner_uuid },
        expCode: 200,
        exp: [ RULES[0] ].concat(RULES.slice(3, 9))
    });
});

test('get: action rule allow owner1', function (t) {
    mod_rule.list(t, {
        params: { action: 'allow', owner_uuid: RULES[1].owner_uuid },
        expCode: 200,
        exp: [ RULES[1] ]
    });
});

test('get: action rule block', function (t) {
    mod_rule.list(t, {
        params: { action: 'block', owner_uuid: OWNERS[0] },
        expCode: 200,
        exp: []
    });
});

test('get: action rule invalid string', function (t) {
    mod_rule.list(t, {
        params: { action: 'kcolb' },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'action',
                code: 'InvalidParameter',
                message: 'action must be "block" or "allow"'
            } ]
        }
    });
});

test('get: action rule invalid type', function (t) {
    mod_rule.list(t, {
        params: { action: 42 },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'action',
                code: 'InvalidParameter',
                message: 'action must be "block" or "allow"'
            } ]
        }
    });
});


test('get: global-bool rule', function (t) {
    mod_rule.list(t, {
        params: { global: true },
        expCode: 200,
        exp: PRE_EXISTING_GLOBALS
    });
});

test('get: global-bool rule invalid type', function (t) {
    mod_rule.list(t, {
        params: { global: 'qwerty' },
        expCode: 422,
        expErr: {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [ {
                field: 'global',
                code: 'InvalidParameter',
                message: 'must be a boolean value'
            } ]
        }
    });
});

test('get: tag rule', function (t) {
    mod_rule.list(t, {
        params: { tag: 'foo', owner_uuid: OWNERS[0] },
        expCode: 200,
        exp: RULES.slice(3, 9)
    });
});

test('get: wildcard rule', function (t) {
    mod_rule.list(t, {
        params: { wildcard: ['some', 'wildcards'] },
        expCode: 200,
        exp: []
    });
});



// --- Teardown



test('teardown', mod_rule.delAllCreated);
