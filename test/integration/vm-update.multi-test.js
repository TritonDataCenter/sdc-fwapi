/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Provision workflow and FWAPI integration tests
 */

var async = require('async');
var config = require('../lib/config');
var fmt = require('util').format;
var mod_cn = require('../lib/cn');
var mod_rule = require('../lib/rule');
var mod_uuid = require('node-uuid');
var mod_vm = require('../lib/vm');
var util = require('util');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var OWNERS = [ config.test.owner_uuid ];
var RULES = {};
var TAGS = {
    // add process.pid to ensure the tags are unique
    role: 'role_' + process.pid
};
var VMS = [];



// --- Setup



// Run before every test
exports.setUp = function (cb) {
    return config.haveTestVars(
        ['owner_uuid', 'provision_image', 'server1_uuid', 'server2_uuid'], cb);
};


// Make sure we have VMs to work with
function checkVMsProvisioned(callback) {
    if (!VMS[0]) {
        return callback(new Error('VM 0 not provisioned'));
    }

    if (!VMS[1]) {
        return callback(new Error('VM 1 not provisioned'));
    }

    return callback();
}



// --- Tests



exports['Add rules'] = {
    'VM 0 to VM 1': function (t) {
        RULES.ssh1 = {
            description: 'allow SSH',
            enabled: true,
            owner_uuid: OWNERS[0],
            rule: util.format(
                'FROM tag %s = one TO tag %s = two ALLOW tcp PORT 22',
                TAGS.role, TAGS.role)
        };

        mod_rule.create(t, {
            rule: RULES.ssh1,
            exp: RULES.ssh1
        });
    }
};


/**
 * Provision two VMs with firewalls disabled
 */
exports['Provision VMs'] = function (t) {
    // Explicitly pick different servers for these VMs, since this is testing
    // that remote VMs get added to other servers.
    var vms = [
        {
            alias: mod_vm.alias(),
            firewall_enabled: false,
            owner_uuid: OWNERS[0],
            server_uuid: config.test.server1_uuid,
            tags: { }
        },
        {
            alias: mod_vm.alias(),
            firewall_enabled: false,
            owner_uuid: OWNERS[0],
            server_uuid: config.test.server2_uuid,
            tags: { }
        }
    ];
    vms[0].tags[TAGS.role] = 'one';
    vms[1].tags[TAGS.role] = 'two';

    mod_vm.provision(t, {
        vms: vms
    }, function (err, res) {
        if (res) {
            VMS = res;
        }

        return t.done();
    });
};


/**
 * Since both VMs have firewalls disabled, no rules or RVMs should have
 * been synced to either CN.
 */
exports['After provision: rules'] = {
    setUp: checkVMsProvisioned,

    // Since both VMs have their firewalls disabled, neither should have
    // the rule present.

    'CN 0: ssh1 rule not present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[0].server_uuid,
            uuid: RULES.ssh1.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    },

    'CN 1: RVM 0 not present': function (t) {
        mod_cn.getRVM(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[0].uuid,
            expCode: 404,
            expErr: mod_cn.rvmNotFoundErr
        });
    },

    'CN 1: ssh1 rule not present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.ssh1.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    }
};


/*
 * Enable VM 1's firewall. This should cause RVM 0 and the SSH rule to be
 * synced to VM1's CN.
 */
exports['Enable firewall'] = {
    setUp: checkVMsProvisioned,

    'update VM': function (t) {
        mod_vm.update(t, {
            uuid: VMS[1].uuid,
            params: { firewall_enabled: true },
            partialExp: { firewall_enabled: true }
        });
    },

    'VM 1: firewall status': function (t) {
        mod_cn.getFwStatus(t, {
            vm: VMS[1],
            exp: true
        });
    },

    'CN 0: ssh1 rule not present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[0].server_uuid,
            uuid: RULES.ssh1.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    },

    'CN 1: ssh1 rule present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.ssh1.uuid,
            exp: RULES.ssh1
        });
    },

    'CN 1: RVM 0 present': function (t) {
        mod_cn.getRVM(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[0].uuid,
            exp: VMS[0]
        });
    }
};



// --- Teardown



exports.teardown = {
    'delete rules': function (t) {
        mod_rule.delAllCreated(t);
    },

    'delete VMs': function (t) {
        mod_vm.delAllCreated(t);
    }
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports.setup,
        setUp: exports.setUp,
        oneTest: runOne,
        teardown: exports.teardown
    };
}
