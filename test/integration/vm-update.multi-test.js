/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Provision workflow and FWAPI integration tests
 */

'use strict';

var test = require('tape');
var config = require('../lib/config');
var mod_cn = require('../lib/cn');
var mod_rule = require('../lib/rule');
var mod_vm = require('../lib/vm');
var util = require('util');



// --- Globals



var OWNERS = [ config.test.owner_uuid ];
var RULES = {};
var TAGS = {
    // add process.pid to ensure the tags are unique
    web: 'web_' + process.pid,
    db: 'db_' + process.pid,
    role: 'role_' + process.pid
};
var VMS = [];



// --- Setup



// Run before every test
function pre_test(t) {
    return config.haveTestVars(
        ['owner_uuid', 'provision_image', 'server1_uuid', 'server2_uuid'],
        t.end);
}

// Make sure we have VMs to work with
function checkVMsProvisioned(t2) {
    if (!VMS[0]) {
        return t2.end((new Error('VM 0 not provisioned')));
    }

    if (!VMS[1]) {
        return t2.end((new Error('VM 1 not provisioned')));
    }

    return t2.end();
}



// --- Tests



test('pre_test', pre_test);
test('Add rules', function (t) {
    t.test('VM 0 to VM 1: SSH', function (t2) {
        RULES.ssh1 = {
            description: 'allow SSH',
            enabled: true,
            owner_uuid: OWNERS[0],
            rule: util.format(
                'FROM tag "%s" = "one" TO tag "%s" = "two" ALLOW tcp PORT 22',
                TAGS.role, TAGS.role)
        };

        mod_rule.create(t2, {
            rule: RULES.ssh1,
            exp: RULES.ssh1
        });
    });

    t.test('VM 2 to VM 1: DB', function (t2) {
        RULES.web1 = {
            description: 'allow DB access',
            enabled: true,
            owner_uuid: OWNERS[0],
            rule: util.format(
                'FROM tag "%s" TO tag "%s" ALLOW tcp PORT 5432',
                TAGS.web, TAGS.db)
        };

        mod_rule.create(t2, {
            rule: RULES.web1,
            exp: RULES.web1
        });
    });
    t.end();
});


/**
 * Provision two VMs with firewalls disabled
 */
test('Provision VMs', function (t) {
    // Explicitly pick different servers for these VMs, since this is ting
    // that remote VMs get added to other servers.
    var vms = [
        {
            firewall_enabled: false,
            owner_uuid: OWNERS[0],
            server_uuid: config.test.server1_uuid,
            tags: { }
        },
        {
            firewall_enabled: false,
            owner_uuid: OWNERS[0],
            server_uuid: config.test.server2_uuid,
            tags: { }
        },
        {
            firewall_enabled: false,
            owner_uuid: OWNERS[0],
            server_uuid: config.test.server1_uuid,
            tags: { }
        }
    ];
    vms[0].tags[TAGS.role] = 'one';
    vms[1].tags[TAGS.role] = 'two';
    vms[1].tags[TAGS.db] = '2';
    vms[2].tags[TAGS.web] = '3';

    mod_vm.provision(t, {
        vms: vms
    }, function (err, res) {
        if (res) {
            VMS = res;
        }

        t.ifError(err, 'Provisioning VMs should succeed');
        t.end();
    });
});

/*
 * Pre-test to be run withing the 'After provision' and 'Enable firewall'
 * group-tests.
 */
var group_pre_test = function (t) {
    t.test(checkVMsProvisioned);
};

/**
 * Since both VMs have firewalls disabled, no rules or RVMs should have
 * been synced to either CN.
 */
test('After provision: rules', function (t) {

    // Since both VMs have their firewalls disabled, neither should have
    // the rule present.

    group_pre_test(t);
    t.test('CN 0: ssh1 rule not present', function (t2) {
        mod_cn.getRule(t2, {
            server_uuid: VMS[0].server_uuid,
            uuid: RULES.ssh1.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    });

    t.test('CN 0: web1 rule not present', function (t2) {
        mod_cn.getRule(t2, {
            server_uuid: VMS[0].server_uuid,
            uuid: RULES.web1.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    });

    t.test('CN 1: RVM 0 not present', function (t2) {
        mod_cn.getRVM(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[0].uuid,
            expCode: 404,
            expErr: mod_cn.rvmNotFoundErr
        });
    });

    t.test('CN 1: RVM 2 not present', function (t2) {
        mod_cn.getRVM(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[2].uuid,
            expCode: 404,
            expErr: mod_cn.rvmNotFoundErr
        });
    });

    t.test('CN 1: ssh1 rule not present', function (t2) {
        mod_cn.getRule(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.ssh1.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    });

    t.test('CN 1: web1 rule not present', function (t2) {
        mod_cn.getRule(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.web1.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    });

    t.end();
});


/*
 * Enable VM 1's firewall. This should cause RVM 0 and the SSH rule to be
 * synced to VM1's CN.
 */
test('Enable firewall', function (t) {

    t.test('update VM', function (t2) {
        mod_vm.update(t2, {
            uuid: VMS[1].uuid,
            params: { firewall_enabled: true },
            partialExp: { firewall_enabled: true }
        });
    });

    t.test('VM 1: firewall status', function (t2) {
        mod_cn.getFwStatus(t2, {
            vm: VMS[1],
            exp: true
        });
    });

    t.test('CN 0: ssh1 rule not present', function (t2) {
        mod_cn.getRule(t2, {
            server_uuid: VMS[0].server_uuid,
            uuid: RULES.ssh1.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    });

    t.test('CN 1: ssh1 rule present', function (t2) {
        mod_cn.getRule(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.ssh1.uuid,
            exp: RULES.ssh1
        });
    });

    t.test('CN 1: web1 rule present', function (t2) {
        mod_cn.getRule(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.web1.uuid,
            exp: RULES.web1
        });
    });

    t.test('CN 1: RVM 0 present', function (t2) {
        mod_cn.getRVM(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[0].uuid,
            exp: VMS[0]
        });
    });

    t.test('CN 1: RVM 2 present', function (t2) {
        mod_cn.getRVM(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[2].uuid,
            exp: VMS[2]
        });
    });

    t.end();
});


test('Remove "web" tag from VM 2', function (t) {

    t.test('update VM', function (t2) {
        mod_vm.removeTag(t2, {
            uuid: VMS[2].uuid,
            tag: TAGS.web
        });
    });

    t.test('CN 1: RVM 2 present and missing "web" tag', function (t2) {
        delete VMS[2].tags[TAGS.web];
        mod_cn.getRVM(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[2].uuid,
            exp: VMS[2]
        });
    });

    t.test('Syncing all CNs', function (t2) {
        mod_cn.syncAll(t2, [ VMS[1].server_uuid ]);
    });

    t.test('CN 1: RVM 2 not present', function (t2) {
        mod_cn.getRVM(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[2].uuid,
            expCode: 404,
            expErr: mod_cn.rvmNotFoundErr
        });
    });

    t.end();
});


test('Add back "web" tag to VM 2', function (t) {

    t.test('update VM', function (t2) {
        VMS[2].tags[TAGS.web] = '4';
        mod_vm.addTags(t2, {
            uuid: VMS[2].uuid,
            tags: VMS[2].tags
        });
    });

    t.test('CN 1: RVM 2 present', function (t2) {
        mod_cn.getRVM(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[2].uuid,
            exp: VMS[2]
        });
    });

    t.end();
});


test('Change value of "role" tag on VM 0', function (t) {

    t.test('update VM', function (t2) {
        VMS[0].tags[TAGS.role] = 'three';
        mod_vm.updateTags(t2, {
            uuid: VMS[0].uuid,
            tags: VMS[0].tags
        });
    });

    t.test('CN 1: RVM 0 updated', function (t2) {
        mod_cn.getRVM(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[0].uuid,
            exp: VMS[0]
        });
    });

    t.test('Syncing all CNs', function (t2) {
        mod_cn.syncAll(t2, [ VMS[1].server_uuid ]);
    });

    t.test('CN 1: RVM 0 not present', function (t2) {
        mod_cn.getRVM(t2, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[0].uuid,
            expCode: 404,
            expErr: mod_cn.rvmNotFoundErr
        });
    });

    t.end();
});




// --- Teardown



test('teardown', function (t) {
    t.test('delete rules', mod_rule.delAllCreated);
    t.test('delete VMs', mod_vm.delAllCreated);
    t.end();
});
