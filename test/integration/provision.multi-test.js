/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Provision workflow and FWAPI integration tests
 */

var async = require('async');
var config = require('../lib/config');
var fmt = require('util').format;
var log = require('../lib/log');
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
    db: 'multi_' + process.pid,
    dns: 'dns_' + process.pid,
    ssh: 'ssh_' + process.pid
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



// --- Create tests



/*
 * Add a couple 'FROM any to tag' rules: these explicitly do not reference
 * other VMs, because they allow traffic from 'any'
 */
exports['Add rules'] = {
    'allow SSH': function (t) {
        RULES.ssh = {
            description: 'allow SSH',
            enabled: true,
            owner_uuid: OWNERS[0],
            rule: util.format('FROM any TO tag %s ALLOW tcp PORT 22',
                TAGS.ssh)
        };

        mod_rule.create(t, {
            rule: RULES.ssh,
            exp: RULES.ssh
        });
    },

    'allow DNS': function (t) {
        RULES.dns = {
            description: 'allow DNS',
            enabled: true,
            owner_uuid: OWNERS[0],
            rule: util.format('FROM any TO tag %s ALLOW udp PORT 53',
                TAGS.dns)
        };

        mod_rule.create(t, {
            rule: RULES.dns,
            exp: RULES.dns
        });
    }
};


exports['Provision VMs'] = function (t) {
    // Explicitly pick different servers for these VMs, since this is testing
    // that remote VMs get added to other servers.
    var vms = [
        {
            firewall_enabled: true,
            owner_uuid: OWNERS[0],
            server_uuid: config.test.server1_uuid,
            tags: { }
        },
        {
            firewall_enabled: true,
            owner_uuid: OWNERS[0],
            server_uuid: config.test.server2_uuid,
            tags: { }
        },
        // No tags for this VM: its purpose is to make sure that firewaller
        // isn't pulling down too many VMs (and later to act as the source
        // for a vm -> vm rule)
        {
            firewall_enabled: true,
            owner_uuid: OWNERS[0],
            server_uuid: config.test.server1_uuid
        }
    ];
    vms[0].tags[TAGS.dns] = true;
    vms[0].tags[TAGS.db] = 1;
    vms[1].tags[TAGS.ssh] = true;
    vms[1].tags[TAGS.db] = 2;

    mod_vm.provision(t, {
        vms: vms
    }, function (err, res) {
        if (res) {
            VMS = res;
        }

        return t.done();
    });
};


exports['After provision: rules'] = {
    setUp: checkVMsProvisioned,

    // CN 0 (with VM 0): should have the DNS rule but not the SSH rule

    'CN 0: SSH rule not present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[0].server_uuid,
            uuid: RULES.ssh.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    },

    'CN 0: DNS rule present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[0].server_uuid,
            uuid: RULES.dns.uuid,
            exp: RULES.dns
        });
    },

    // CN 1 (with VM 1): should have the SSH rule but not the DNS rule

    'CN 1: SSH rule present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.ssh.uuid,
            exp: RULES.ssh
        });
    },

    'CN 1: DNS rule not present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.dns.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    },

    'FWAPI rules for VM 0': function (t) {
        mod_rule.vmRules(t, {
            uuid: VMS[0].uuid,
            exp: [ RULES.dns ]
        });
    },

    'FWAPI rules for VM 1': function (t) {
        mod_rule.vmRules(t, {
            uuid: VMS[1].uuid,
            exp: [ RULES.ssh ]
        });
    }
};


/*
 * Add a disabled rule
 */
exports['Add disabled rule'] = {
    setUp: checkVMsProvisioned,

    'add': function (t) {
        RULES.db = {
            description: 'allow DB',
            enabled: false,
            owner_uuid: OWNERS[0],
            rule: util.format('FROM (tag %s = 1 OR tag %s = 2) TO ' +
                '(tag %s = 1 OR tag %s = 2) ALLOW tcp PORT 5432',
                TAGS.db, TAGS.db, TAGS.db, TAGS.db)
        };

        mod_rule.create(t, {
            rule: RULES.db,
            exp: RULES.db
        });
    },

    // The rule is disabled, so no rules or remote VMs should have been
    // added to either CN

    'CN 0: DB rule not present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[0].server_uuid,
            uuid: RULES.db.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    },

    'CN 1: DB rule not present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.db.uuid,
            expCode: 404,
            expErr: mod_cn.notFoundErr
        });
    },

    'CN 0: RVM 1 not present': function (t) {
        mod_cn.getRVM(t, {
            server_uuid: VMS[0].server_uuid,
            uuid: VMS[1].uuid,
            expCode: 404,
            expErr: mod_cn.rvmNotFoundErr
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

    'CN 1: RVM 2 not present': function (t) {
        mod_cn.getRVM(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[2].uuid,
            expCode: 404,
            expErr: mod_cn.rvmNotFoundErr
        });
    }
};


exports['Enable rule'] = {
    setUp: checkVMsProvisioned,

    'enable': function (t) {
        mod_rule.updateAndGet(t, {
            uuid: RULES.db.uuid,
            params: { enabled: true },
            partialExp: { enabled: true },
            rule: RULES.db
        });
    },


    // CN 0 (with VM 0): should have the DB rule and the
    // other RVM (VM 1) tagged with db

    'CN 0: after enable: DB rule present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[0].server_uuid,
            uuid: RULES.db.uuid,
            exp: RULES.db
        });
    },

    'CN 0: RVM 1 present': function (t) {
        mod_cn.getRVM(t, {
            server_uuid: VMS[0].server_uuid,
            uuid: VMS[1].uuid,
            exp: VMS[1]
        });
    },


    // CN 1 (with VM 1): should have the DB rule and the
    // other RVM (VM 0) tagged with db

    'CN 1: after enable: DB rule present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.db.uuid,
            exp: RULES.db
        });
    },

    'CN 1: RVM 0 not present': function (t) {
        mod_cn.getRVM(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[0].uuid,
            exp: VMS[0]
        });
    },

    // The VM that is not referenced in the rule should not be on
    // either server

    'CN 0: RVM 2 not present': function (t) {
        mod_cn.getRVM(t, {
            server_uuid: VMS[0].server_uuid,
            uuid: VMS[2].uuid,
            expCode: 404,
            expErr: mod_cn.rvmNotFoundErr
        });
    },

    'CN 1: RVM 2 not present': function (t) {
        mod_cn.getRVM(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[2].uuid,
            expCode: 404,
            expErr: mod_cn.rvmNotFoundErr
        });
    },

    'FWAPI rules for VM 0': function (t) {
        mod_rule.vmRules(t, {
            uuid: VMS[0].uuid,
            exp: [ RULES.dns, RULES.db ]
        });
    },

    'FWAPI rules for VM 1': function (t) {
        mod_rule.vmRules(t, {
            uuid: VMS[1].uuid,
            exp: [ RULES.db, RULES.ssh ]
        });
    }
};


/*
 * Add a VM -> VM rule
 */
exports['Add VMs rule'] = {
    setUp: checkVMsProvisioned,

    'add': function (t) {
        RULES.https = {
            enabled: true,
            owner_uuid: OWNERS[0],
            rule: util.format('FROM vm %s TO vm %s ALLOW tcp PORT 443',
                VMS[2].uuid, VMS[1].uuid)
        };

        mod_rule.create(t, {
            rule: RULES.https,
            exp: RULES.https
        });
    },

    // The rule should be added to CN 0 (VM 2's CN)

    'CN 0: HTTPS rule not present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[0].server_uuid,
            uuid: RULES.https.uuid,
            exp: RULES.https
        });
    },

    // Both the rule and RVM 2 should be added to CN 1 (VM 1's CN)

    'CN 1: HTTPS rule present': function (t) {
        mod_cn.getRule(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: RULES.https.uuid,
            exp: RULES.https
        });
    },

    'CN 1: RVM 2 present': function (t) {
        mod_cn.getRVM(t, {
            server_uuid: VMS[1].server_uuid,
            uuid: VMS[2].uuid,
            exp: VMS[2]
        });
    },

    'FWAPI rules for VM 1': function (t) {
        mod_rule.vmRules(t, {
            uuid: VMS[1].uuid,
            exp: [ RULES.db, RULES.https, RULES.ssh ]
        });
    },

    'FWAPI rules for VM 2': function (t) {
        mod_rule.vmRules(t, {
            uuid: VMS[2].uuid,
            exp: [ RULES.https ]
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
