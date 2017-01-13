/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Data for testing migrating rules
 */

'use strict';

var assert = require('assert-plus');
var fwrule = require('fwrule');
var mod_uuid = require('node-uuid');

var fmt = require('util').format;


// --- Globals

var UFDS_FWRULE_PARENT = [ 'ou=fwrules, o=smartdc' ];
var UFDS_FWRULE_CLASS = [ 'fwrule' ];

var GENERIC_COUNT = 10000;
var GENERIC_DESC = 'Allow VM %s to access ports %d to %d on "foo" VMs.';
var GENERIC_RULE = 'FROM vm %s TO tag "role" = "foo" ALLOW tcp PORTS %d - %d';

var UPDATE_HOST = require('os').hostname();
var UPDATE_VM = mod_uuid.v4();
var UPDATE_CN = mod_uuid.v4();


// --- Internals

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}


// --- Rule-related Exports


var RULES_SCHEMA_V1 = {
    options: {
        'version': 1
    },
    index: {
        'uuid': {
            'type': 'string',
            'unique': true
        },
        '_v': { 'type': 'number' },
        'version': { 'type': 'string' },
        'owner': { 'type': 'string' },
        'action': { 'type': 'string' },
        'protocol': { 'type': 'string' },
        'enabled': { 'type': 'boolean' },
        'fromwildcards': {
            'type': '[string]'
        },
        'towildcards': {
            'type': '[string]'
        },
        'fromips': {
            'type': '[ip]'
        },
        'toips': {
            'type': '[ip]'
        },
        'fromsubnets': {
            'type': '[subnet]'
        },
        'tosubnets': {
            'type': '[subnet]'
        },
        'fromtagkeys': {
            'type': '[string]'
        },
        'totagkeys': {
            'type': '[string]'
        },
        'fromtags': {
            'type': '[string]'
        },
        'totags': {
            'type': '[string]'
        },
        'fromvms': {
            'type': '[string]'
        },
        'tovms': {
            'type': '[string]'
        }
    }
};



var OWNER_1 = mod_uuid.v4();
var OWNER_2 = mod_uuid.v4();
var OWNER_3 = mod_uuid.v4();
var OWNER_4 = mod_uuid.v4();

var RULE_1_UUID = mod_uuid.v4();
var RULE_2_UUID = mod_uuid.v4();
var RULE_3_UUID = mod_uuid.v4();
var RULE_4_UUID = mod_uuid.v4();
var RULE_5_UUID = mod_uuid.v4();
var RULE_6_UUID = mod_uuid.v4();
var RULE_7_UUID = mod_uuid.v4();
var RULE_8_UUID = mod_uuid.v4();
var RULE_9_UUID = mod_uuid.v4();
var RULE_10_UUID = mod_uuid.v4();
var RULE_11_UUID = mod_uuid.v4();
var RULE_12_UUID = mod_uuid.v4();

var RULE_1_VERSION = fwrule.generateVersion();
var RULE_2_VERSION = fwrule.generateVersion();
var RULE_3_VERSION = fwrule.generateVersion();
var RULE_4_VERSION = fwrule.generateVersion();
var RULE_5_VERSION = fwrule.generateVersion();
var RULE_6_VERSION = fwrule.generateVersion();
var RULE_7_VERSION = fwrule.generateVersion();
var RULE_8_VERSION = fwrule.generateVersion();
var RULE_9_VERSION = fwrule.generateVersion();
var RULE_10_VERSION = fwrule.generateVersion();
var RULE_11_VERSION = fwrule.generateVersion();
var RULE_12_VERSION = fwrule.generateVersion();

var rules = {};

// A blocking rule
rules[RULE_1_UUID] = {
    'ufds': {
        'action': [ 'block' ],
        'enabled': [ 'true' ],
        'fromwildcard': [ 'vmall' ],
        'objectclass': UFDS_FWRULE_CLASS,
        'owner': [ OWNER_1 ],
        'ports': [ '22' ],
        'protocol': [ 'tcp' ],
        'towildcard': [ 'any' ],
        'uuid': [ RULE_1_UUID ],
        'version': [ RULE_1_VERSION ],
        '_parent': UFDS_FWRULE_PARENT
    },
    'v1': {
        '_v': 1,
        'action': 'block',
        'enabled': true,
        'fromwildcards': [ 'vmall' ],
        'owner': OWNER_1,
        'ports': [ '[22,22]' ],
        'protocol': 'tcp',
        'towildcards': [ 'any' ],
        'uuid': RULE_1_UUID,
        'version': RULE_1_VERSION
    },
    'fwapi': {
        'rule': 'FROM all vms TO any BLOCK tcp PORT 22',
        'uuid': RULE_1_UUID,
        'version': RULE_1_VERSION,
        'owner_uuid': OWNER_1,
        'enabled': true
    }
};


// Rule with a bad subnet in UFDS that needs to be fixed up
rules[RULE_2_UUID] = {
    'ufds': {
        'action': [ 'allow' ],
        'enabled': [ 'true' ],
        'fromsubnet': [
          '167804930/21',
          '168427523/18'
        ],
        'objectclass': UFDS_FWRULE_CLASS,
        'owner': [ OWNER_1 ],
        'ports': [ 'all' ],
        'protocol': [ 'udp' ],
        'totag': [ 'manta_role=loadbalancer=10' ],
        'uuid': [ RULE_2_UUID ],
        'version': [ RULE_2_VERSION ],
        '_parent': UFDS_FWRULE_PARENT
    },
    'v1': {
        '_v': 1,
        'action': 'allow',
        'enabled': true,
        'fromsubnets': [ '10.0.128.0/21', '10.10.0.0/18' ],
        'owner': OWNER_1,
        'ports': [ '[1,65535]' ],
        'protocol': 'udp',
        'totags': [ 'manta_role=loadbalancer=10' ],
        'totagkeys': [ 'manta_role' ],
        'uuid': RULE_2_UUID,
        'version': RULE_2_VERSION
    },
    'fwapi': {
        'rule': 'FROM (subnet 10.0.128.0/21 OR subnet 10.10.0.0/18) TO '
            + 'tag "manta_role" = "loadbalancer" ALLOW udp PORT all',
        'uuid': RULE_2_UUID,
        'version': RULE_2_VERSION,
        'owner_uuid': OWNER_1,
        'enabled': true
    }
};


// Rule with a port range
rules[RULE_3_UUID] = {
    'ufds': {
        'action': [ 'allow' ],
        'description': [ 'this is a rule with port ranges' ],
        'enabled': [ 'false' ],
        'fromsubnet': [ '167772160/24' ],
        'objectclass': UFDS_FWRULE_CLASS,
        'owner': [ OWNER_2 ],
        'ports': [ '53', '8300-8302', '8400', '8500', '8600' ],
        'protocol': [ 'tcp' ],
        'totag': [ 'role=etcd=4' ],
        'uuid': [ RULE_3_UUID ],
        'version': [ RULE_3_VERSION ],
        '_parent': UFDS_FWRULE_PARENT
    },
    'v1': {
        '_v': 1,
        'action': 'allow',
        'description': 'this is a rule with port ranges',
        'enabled': false,
        'fromsubnets': [ '10.0.0.0/24' ],
        'owner': OWNER_2,
        'ports': [
            '[53,53]', '[8300,8302]', '[8400,8400]',
            '[8500,8500]', '[8600,8600]'
        ],
        'protocol': 'tcp',
        'totags': [ 'role=etcd=4' ],
        'totagkeys': [ 'role' ],
        'uuid': RULE_3_UUID,
        'version': RULE_3_VERSION
    },
    'fwapi': {
        'rule': 'FROM subnet 10.0.0.0/24 TO tag "role" = "etcd" ALLOW '
            + 'tcp PORTS 53, 8300 - 8302, 8400, 8500, 8600',
        'description': 'this is a rule with port ranges',
        'uuid': RULE_3_UUID,
        'version': RULE_3_VERSION,
        'owner_uuid': OWNER_2,
        'enabled': false
    }
};


// Rule with multiple tags
rules[RULE_4_UUID] = {
    'ufds': {
        'action': [ 'allow' ],
        'enabled': [ 'false' ],
        'fromsubnet': [ '167772160/24' ],
        'objectclass': UFDS_FWRULE_CLASS,
        'owner': [ OWNER_2 ],
        'ports': [ '80', '443' ],
        'protocol': [ 'tcp' ],
        'totag': [ 'web==3', 'role=http=4' ],
        'uuid': [ RULE_4_UUID ],
        'version': [ RULE_4_VERSION ],
        '_parent': UFDS_FWRULE_PARENT
    },
    'v1': {
        '_v': 1,
        'action': 'allow',
        'enabled': false,
        'fromsubnets': [ '10.0.0.0/24' ],
        'owner': OWNER_2,
        'ports': [ '[80,80]', '[443,443]' ],
        'protocol': 'tcp',
        'totags': [ 'role=http=4', 'web==3' ],
        'totagkeys': [ 'role', 'web' ],
        'uuid': RULE_4_UUID,
        'version': RULE_4_VERSION
    },
    'fwapi': {
        'rule': 'FROM subnet 10.0.0.0/24 TO '
            + '(tag "role" = "http" OR tag "web") ALLOW '
            + 'tcp (PORT 80 AND PORT 443)',
        'uuid': RULE_4_UUID,
        'version': RULE_4_VERSION,
        'owner_uuid': OWNER_2,
        'enabled': false
    }
};


// A global rule
rules[RULE_5_UUID] = {
    'ufds': {
        'action': [ 'allow' ],
        'description': [ 'allow pings to all VMs' ],
        'enabled': [ 'true' ],
        'fromwildcard': [ 'any' ],
        'objectclass': UFDS_FWRULE_CLASS,
        'protocol': [ 'icmp' ],
        'towildcard': [ 'vmall' ],
        'types': [ '8:0' ],
        'uuid': [ RULE_5_UUID ],
        'version': [ RULE_5_VERSION ],
        '_parent': UFDS_FWRULE_PARENT
    },
    'v1': {
        '_v': 1,
        'action': 'allow',
        'description': 'allow pings to all VMs',
        'enabled': true,
        'fromwildcards': [ 'any' ],
        'protocol': 'icmp',
        'towildcards': [ 'vmall' ],
        'types': [ '8:0' ],
        'uuid': RULE_5_UUID,
        'version': RULE_5_VERSION
    },
    'fwapi': {
        'rule': 'FROM any TO all vms ALLOW icmp TYPE 8 CODE 0',
        'description': 'allow pings to all VMs',
        'uuid': RULE_5_UUID,
        'version': RULE_5_VERSION,
        'enabled': true,
        'global': true
    }
};


// A rule with escaped characters
rules[RULE_6_UUID] = {
    'ufds': {
        'action': [ 'allow' ],
        'description': [ 'this rule has escaped characters in tags' ],
        'enabled': [ 'true' ],
        'fromtag': [ '\\u2603=\\u0631\\u062c\\u0644 '
            + '\\u0627\\u0644\\u062b\\u0644\\u062c=6' ],
        'objectclass': UFDS_FWRULE_CLASS,
        'owner': [ OWNER_3 ],
        'protocol': [ 'tcp' ],
        'totag': [  '\\u26C4==6' ],
        'ports': [ '22' ],
        'uuid': [ RULE_6_UUID ],
        'version': [ RULE_6_VERSION ],
        '_parent': UFDS_FWRULE_PARENT
    },
    'v1': {
        '_v': 1,
        'action': 'allow',
        'description': 'this rule has escaped characters in tags',
        'enabled': true,
        'fromtagkeys': [ '\\u2603' ],
        'fromtags': [ '\\u2603=\\u0631\\u062c\\u0644 '
            + '\\u0627\\u0644\\u062b\\u0644\\u062c=6' ],
        'owner': OWNER_3,
        'protocol': 'tcp',
        'totagkeys': [  '\\u26C4' ],
        'totags': [  '\\u26C4==6' ],
        'ports': [ '[22,22]' ],
        'uuid': RULE_6_UUID,
        'version': RULE_6_VERSION
    },
    'fwapi': {
        'rule': 'FROM tag "☃" = "رجل الثلج" TO tag "⛄" ALLOW tcp PORT 22',
        'description': 'this rule has escaped characters in tags',
        'uuid': RULE_6_UUID,
        'version': RULE_6_VERSION,
        'owner_uuid': OWNER_3,
        'enabled': true
    }
};


// TCP rule created for accounts that use sdc-docker
rules[RULE_7_UUID] = {
    'ufds': {
        'action': [ 'allow' ],
        'enabled': [ 'true' ],
        'fromtag': [ 'sdc_docker==10' ],
        'objectclass': UFDS_FWRULE_CLASS,
        'owner': [ OWNER_4 ],
        'ports': [ 'all' ],
        'protocol': [ 'tcp' ],
        'totag': [ 'sdc_docker==10' ],
        'uuid': [ RULE_7_UUID ],
        'version': [ RULE_7_VERSION ],
        '_parent': UFDS_FWRULE_PARENT
    },
    'v1': {
        '_v': 1,
        'action': 'allow',
        'enabled': true,
        'fromtagkeys': [ 'sdc_docker' ],
        'fromtags': [ 'sdc_docker==10' ],
        'owner': OWNER_4,
        'protocol': 'tcp',
        'totagkeys': [  'sdc_docker' ],
        'totags': [  'sdc_docker==10' ],
        'ports': [ '[1,65535]' ],
        'uuid': RULE_7_UUID,
        'version': RULE_7_VERSION
    },
    'fwapi': {
        'rule': 'FROM tag "sdc_docker" TO tag "sdc_docker" ALLOW tcp PORT all',
        'uuid': RULE_7_UUID,
        'version': RULE_7_VERSION,
        'owner_uuid': OWNER_4,
        'enabled': true
    }
};


// UDP rule created for accounts that use sdc-docker
rules[RULE_8_UUID] = {
    'ufds': {
        'action': [ 'allow' ],
        'enabled': [ 'true' ],
        'fromtag': [ 'sdc_docker==10' ],
        'objectclass': UFDS_FWRULE_CLASS,
        'owner': [ OWNER_4 ],
        'ports': [ 'all' ],
        'protocol': [ 'udp' ],
        'totag': [ 'sdc_docker==10' ],
        'uuid': [ RULE_8_UUID ],
        'version': [ RULE_8_VERSION ],
        '_parent': UFDS_FWRULE_PARENT
    },
    'v1': {
        '_v': 1,
        'action': 'allow',
        'enabled': true,
        'fromtagkeys': [ 'sdc_docker' ],
        'fromtags': [ 'sdc_docker==10' ],
        'owner': OWNER_4,
        'protocol': 'udp',
        'totagkeys': [  'sdc_docker' ],
        'totags': [  'sdc_docker==10' ],
        'ports': [ '[1,65535]' ],
        'uuid': RULE_8_UUID,
        'version': RULE_8_VERSION
    },
    'fwapi': {
        'rule': 'FROM tag "sdc_docker" TO tag "sdc_docker" ALLOW udp PORT all',
        'uuid': RULE_8_UUID,
        'version': RULE_8_VERSION,
        'owner_uuid': OWNER_4,
        'enabled': true
    }
};


// TCP exposed port rule created for a Docker container
rules[RULE_9_UUID] = {
    'ufds': {
        'action': [ 'allow' ],
        'enabled': [ 'true' ],
        'fromwildcard': [ 'any' ],
        'objectclass': UFDS_FWRULE_CLASS,
        'owner': [ OWNER_4 ],
        'ports': [ '80' ],
        'protocol': [ 'tcp' ],
        'tovm': [ 'ba62757f-fa18-4993-9f9d-0700391d660a' ],
        'uuid': [ RULE_9_UUID ],
        'version': [ RULE_9_VERSION ],
        '_parent': UFDS_FWRULE_PARENT
    },
    'v1': {
        '_v': 1,
        'action': 'allow',
        'enabled': true,
        'fromwildcards': [ 'any' ],
        'owner': OWNER_4,
        'ports': [ '[80,80]' ],
        'protocol': 'tcp',
        'tovms': [ 'ba62757f-fa18-4993-9f9d-0700391d660a' ],
        'uuid': RULE_9_UUID,
        'version': RULE_9_VERSION
    },
    'fwapi': {
        'rule': 'FROM any TO vm ba62757f-fa18-4993-9f9d-0700391d660a ALLOW '
            + 'tcp PORT 80',
        'uuid': RULE_9_UUID,
        'version': RULE_9_VERSION,
        'owner_uuid': OWNER_4,
        'enabled': true
    }
};


// ICMPv6 rule
rules[RULE_10_UUID] = {
    'v1': {
        '_v': 1,
        'action': 'allow',
        'description': 'allow all ICMPv6 types',
        'enabled': true,
        'fromwildcards': [ 'any' ],
        'protocol': 'icmp6',
        'towildcards': [ 'vmall' ],
        'types': [ 'all' ],
        'uuid': RULE_10_UUID,
        'version': RULE_10_VERSION
    },
    'fwapi': {
        'rule': 'FROM any TO all vms ALLOW icmp6 TYPE all',
        'description': 'allow all ICMPv6 types',
        'uuid': RULE_10_UUID,
        'version': RULE_10_VERSION,
        'enabled': true,
        'global': true
    }
};


// IPv6 address rule
rules[RULE_11_UUID] = {
    'v1': {
        '_v': 1,
        'action': 'allow',
        'enabled': true,
        'fromips': [ 'fd00::5' ],
        'owner': OWNER_4,
        'protocol': 'tcp',
        'towildcards': [ 'vmall' ],
        'ports': [ '[1,65535]' ],
        'uuid': RULE_11_UUID,
        'version': RULE_11_VERSION
    },
    'fwapi': {
        'rule': 'FROM ip fd00::5 TO all vms ALLOW tcp PORT all',
        'uuid': RULE_11_UUID,
        'owner_uuid': OWNER_4,
        'version': RULE_11_VERSION,
        'enabled': true
    }
};


// IPv6 subnet rule
rules[RULE_12_UUID] = {
    'v1': {
        '_v': 1,
        'action': 'allow',
        'enabled': true,
        'fromsubnets': [ 'fc00::/7' ],
        'owner': OWNER_4,
        'protocol': 'udp',
        'towildcards': [ 'vmall' ],
        'ports': [ '[22,22]', '[80,80]' ],
        'uuid': RULE_12_UUID,
        'version': RULE_12_VERSION
    },
    'fwapi': {
        'rule': 'FROM subnet fc00::/7 TO all vms ALLOW '
            + 'udp (PORT 22 AND PORT 80)',
        'uuid': RULE_12_UUID,
        'owner_uuid': OWNER_4,
        'version': RULE_12_VERSION,
        'enabled': true
    }
};


function generateRule() {
    var rule_uuid = mod_uuid.v4();
    var owner_uuid = mod_uuid.v4();
    var vm_uuid = mod_uuid.v4();

    assert.ok(!rules.hasOwnProperty(rule_uuid), 'unused uuid');

    var offset = getRandomInt(10, 5000);
    var start = getRandomInt(1, 60000);
    var end = start + offset;
    var version = fwrule.generateVersion();
    var desc = fmt(GENERIC_DESC, vm_uuid, start, end);

    rules[rule_uuid] = {
        'ufds': {
            'action': [ 'allow' ],
            'description': [ desc ],
            'enabled': [ 'true' ],
            'fromvm': [ vm_uuid ],
            'objectclass': UFDS_FWRULE_CLASS,
            'owner': [ owner_uuid ],
            'ports': [ fmt('%d-%d', start, end) ],
            'protocol': [ 'tcp' ],
            'totag': [ 'role=foo=4' ],
            'uuid': [ rule_uuid ],
            'version': version,
            '_parent': UFDS_FWRULE_PARENT
        },
        'v1': {
            '_v': 1,
            'action': 'allow',
            'description': desc,
            'enabled': true,
            'fromvms': [ vm_uuid ],
            'owner': owner_uuid,
            'ports': [ fmt('[%d,%d]', start, end) ],
            'protocol': 'tcp',
            'totags': [ 'role=foo=4' ],
            'totagkeys': [ 'role' ],
            'uuid': rule_uuid,
            'version': version
        },
        'fwapi': {
            'rule': fmt(GENERIC_RULE, vm_uuid, start, end),
            'description': desc,
            'uuid': rule_uuid,
            'version': version,
            'owner_uuid': owner_uuid,
            'enabled': true
        }
    };
}


/**
 * Generate a large number of generic rules to force multiple rounds
 * of reindexing/migration/etc.
 */
for (var i = 0; i < GENERIC_COUNT; i++) {
    generateRule();
}


// --- Updates-related exports


var ORIG_UPDATE_SCHEMA = {
    index: {
        host: { type: 'string' },
        uuid: { type: 'string', unique: true },
        _v: { type: 'number' }
    }
};


var UPDATE_1_UUID = mod_uuid.v1();
var UPDATE_2_UUID = mod_uuid.v1();
var UPDATE_3_UUID = mod_uuid.v1();
var UPDATE_4_UUID = mod_uuid.v1();
var UPDATE_5_UUID = mod_uuid.v1();


var updates = {};


updates[UPDATE_1_UUID] = {
    'orig': {
        '_v': 1,
        'host': UPDATE_HOST,
        'name': 'fw.del_rule',
        'value': {
            'owner_uuid': OWNER_1,
            'enabled': true,
            'rule': 'FROM tag a TO tag b BLOCK tcp PORT 80',
            'uuid': mod_uuid.v4(),
            'version': fwrule.generateVersion()
        }
    }
};


updates[UPDATE_2_UUID] = {
    'orig': {
        '_v': 1,
        'host': UPDATE_HOST,
        'name': 'sync',
        'value': {
            'type': 'sync',
            'req_id': mod_uuid.v4()
        }
    }
};


updates[UPDATE_3_UUID] = {
    'orig': {
        '_v': 1,
        'host': UPDATE_HOST,
        'name': 'vm.add',
        'value': {
            'type': 'vm.add',
            'owner_uuid': OWNER_1,
            'uuid': UPDATE_VM,
            'firewall_enabled': true,
            'nics': [
              {
                'belongs_to_type': 'zone',
                'belongs_to_uuid': UPDATE_VM,
                'mac': '90:b8:d0:fb:67:b6',
                'owner_uuid': OWNER_1,
                'primary': true,
                'state': 'provisioning',
                'ip': '10.0.0.93',
                'gateway': '10.0.0.1',
                'mtu': 1500,
                'netmask': '255.255.255.0',
                'nic_tag': 'external',
                'resolvers': [
                  '8.8.8.8',
                  '8.8.4.4'
                ],
                'vlan_id': 5,
                'network_uuid': mod_uuid.v4(),
                'cn_uuid': UPDATE_CN
              }
            ],
            'tags': {
              'sdc_docker': true
            }
        }
    }
};


updates[UPDATE_4_UUID] = {
    'orig': {
        '_v': 1,
        'host': UPDATE_HOST,
        'name': 'vm.update',
        'value': {
            'type': 'vm.update',
            'uuid': UPDATE_VM,
            'set_tags': {
                'triton.cns.disable': false,
                'triton.cns.services': 'foo,bar'
            }
        }
    }
};


updates[UPDATE_5_UUID] = {
    'orig': {
        '_v': 1,
        'host': UPDATE_HOST,
        'name': 'vm.delete',
        'value': {
            'type': 'vm.delete',
            'owner_uuid': OWNER_1,
            'server_uuid': UPDATE_CN,
            'uuid': UPDATE_VM
        }
    }
};


module.exports = {
    OWNER_1: OWNER_1,
    OWNER_2: OWNER_2,
    OWNER_3: OWNER_3,
    OWNER_4: OWNER_4,

    RULES_SCHEMA_V1: RULES_SCHEMA_V1,
    RULE_1_UUID: RULE_1_UUID,
    RULE_2_UUID: RULE_2_UUID,
    RULE_3_UUID: RULE_3_UUID,
    RULE_4_UUID: RULE_4_UUID,
    RULE_5_UUID: RULE_5_UUID,
    RULE_6_UUID: RULE_6_UUID,
    RULE_7_UUID: RULE_7_UUID,
    RULE_8_UUID: RULE_8_UUID,
    RULE_9_UUID: RULE_9_UUID,
    RULE_10_UUID: RULE_10_UUID,
    GENERIC_COUNT: GENERIC_COUNT,
    rules: rules,

    ORIG_UPDATE_SCHEMA: ORIG_UPDATE_SCHEMA,
    updates: updates
};
