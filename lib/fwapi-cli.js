/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * The Firewall API control application
 */

/* eslint-disable no-unused-vars */

'use strict';

var assert = require('assert-plus');
var cli = require('./cli');
var cmdln = require('cmdln');
var fs = require('fs');
var FWAPI = require('sdc-clients').FWAPI;
var path = require('path');
var util = require('util');
var VMAPI = require('sdc-clients').VMAPI;



// --- Globals



var CONFIG;
var OPTS = {
    agents: {
        names: ['agents', 'a'],
        type: 'bool',
        help: 'Ping all connected agents'
    },
    description: {
        names: ['description', 'desc'],
        type: 'string',
        help: 'Rule description'
    },
    enable: {
        names: ['enable', 'e'],
        type: 'bool',
        help: 'Enable the rule'
    },
    file: {
        names: ['file', 'f'],
        type: 'string',
        help: 'Input file with rule'
    },
    global: {
        names: ['global', 'g'],
        type: 'bool',
        help: 'Global rule'
    },
    owner_uuid: {
        names: ['owner_uuid', 'O'],
        type: 'string',
        help: 'Owner UUID'
    }
};
var VERBOSE = false;



// --- Internal helpers



/*
 * Exits with a message.
 */
function exit() {
    console.error.apply(null, Array.prototype.slice.apply(arguments));
    process.exit(1);
}


/*
 * Parses params in argv for key=val parameters, and returns them as a hash.
 */
function getKeyValParams(args, idx) {
    var params = {};
    var errs = [];
    if (!idx) {
        idx = 0;
    }

    for (var i = idx; i < args.length; i++) {
        var split = args[i].split('=');
        if (split.length !== 2) {
            errs.push(args[i]);
            continue;
        }
        params[split[0]] = split[1];
    }

    if (errs.length !== 0) {
        exit('Invalid parameter%s: %s',
            (errs.length === 1 ? '' : 's'), errs.join(', '));
    }

    return params;
}


/*
 * Generic handler for callbacks: prints out an error if there is one,
 * stringifies the JSON otherwise.
 */
function standardHandler(opts, err, obj, req, res) {
    if (err) {
        return cli.exitWithErr(err, opts);
    }

    if (VERBOSE) {
        console.log('Status code: %d', res.statusCode);
    }

    return console.log(cli.json(obj));
}



// --- cmdln command handlers



function FwapiCLI() {
    cmdln.Cmdln.call(this, {
        name: 'fwapi',
        desc: 'control program for the SDC Firewall API',
        options: [
            { names: ['help', 'h'], type: 'bool',
                help: 'Print help and exit.' },
            { names: ['json', 'j'], type: 'bool', help: 'Output JSON.' },
            { names: ['verbose', 'v'], type: 'bool', default: false,
                help: 'Verbose output.' }
        ]
    });

    CONFIG = JSON.parse(fs.readFileSync(
        path.normalize(__dirname + '/../config.json'), 'utf-8'));
    assert.number(CONFIG.port);

    this.fwapi = new FWAPI({
        agent: false,
        url: 'http://localhost:' + CONFIG.port
    });
}

util.inherits(FwapiCLI, cmdln.Cmdln);


FwapiCLI.prototype.init = function (opts, args, callback) {
    if (opts.verbose) {
        VERBOSE = true;
    }

    cmdln.Cmdln.prototype.init.apply(this, arguments);
};


/**
 * Lists firewall rules
 */
FwapiCLI.prototype.do_list = function (subcmd, opts, args, callback) {
    return this.fwapi.listRules(getKeyValParams(args),
        standardHandler.bind(null, opts));
};

FwapiCLI.prototype.do_list.help = 'List rules.';


/**
 * Adds a firewall rule
 */
FwapiCLI.prototype.do_add = function (subcmd, opts, args, callback) {
    var self = this;
    cli.getPayload(opts, args, function (err, payload) {
        if (err) {
            return callback(err);
        }

        return self.fwapi.createRule(payload, standardHandler.bind(null, opts));
    });
};

FwapiCLI.prototype.do_add.help = 'Add a rule.';
FwapiCLI.prototype.do_add.options = [
    OPTS.description,
    OPTS.enable,
    OPTS.file,
    OPTS.global,
    OPTS.owner_uuid
];


/**
 * Updates a firewall rule
 */
FwapiCLI.prototype.do_update = function (subcmd, opts, args, callback) {
    var self = this;
    var id;
    if (args.length !== 0) {
        id = args.shift();
    }

    cli.getPayload(opts, args, function (err, payload) {
        if (err) {
            return callback(err);
        }

        if (!id) {
            id = payload.id;
        }

        if (!id) {
            return callback('Error: must supply rule UUID!');
        }
        delete payload.id;

        return self.fwapi.updateRule(id, payload,
            standardHandler.bind(null, opts));
    });
};

FwapiCLI.prototype.do_update.help = 'Update a rule.';
FwapiCLI.prototype.do_update.options = [
    OPTS.description,
    OPTS.enable,
    OPTS.file
];


/**
 * Enables or disables a firewall depending on subcmd
 */
function enableDisable(subcmd, opts, args, callback) {
    if (!args[0]) {
        return callback(new Error('Error: must supply rule UUID!'));
    }

    // eslint-disable-next-line no-invalid-this
    return this.fwapi.updateRule(args[0], { enabled: subcmd === 'enable' },
        standardHandler.bind(null, opts));
}

FwapiCLI.prototype.do_enable = function () {
    enableDisable.apply(this, arguments);
};

FwapiCLI.prototype.do_enable.help = 'Enable a rule.';

FwapiCLI.prototype.do_disable = function () {
    enableDisable.apply(this, arguments);
};

FwapiCLI.prototype.do_disable.help = 'Disable a rule.';


/**
 * Gets a firewall rule
 */
FwapiCLI.prototype.do_get = function (subcmd, opts, args, callback) {
    if (!args[0]) {
        return callback(new Error('Error: must supply rule UUID!'));
    }

    return this.fwapi.getRule(args[0], getKeyValParams(args, 1),
        standardHandler.bind(null, opts));
};

FwapiCLI.prototype.do_get.help = 'Get a rule.';


/**
 * Deletes a firewall rule
 */
FwapiCLI.prototype.do_delete = function (subcmd, opts, args, callback) {
    if (!args[0]) {
        return callback(new Error('Error: must supply rule UUID!'));
    }

    return this.fwapi.deleteRule(args[0], getKeyValParams(args, 1),
        standardHandler.bind(null, opts));
};

FwapiCLI.prototype.do_delete.help = 'Delete a rule.';


/**
 * Ping the API
 */
FwapiCLI.prototype.do_ping = function (subcmd, opts, args, callback) {
    var payload = {};
    if (opts.agents) {
        payload.agents = true;
    }

    return this.fwapi.ping(payload, standardHandler.bind(null, opts));
};

FwapiCLI.prototype.do_ping.help = 'Check the status of the API.';
FwapiCLI.prototype.do_ping.options = [
    OPTS.agents
];


/**
 * Lists rules that affect a VM
 */
FwapiCLI.prototype.do_rules = function (subcmd, opts, args, callback) {
    if (!args[0]) {
        return callback(new Error('Error: must supply VM UUID!'));
    }

    return this.fwapi.getVMrules(args[0], getKeyValParams(args, 1),
        standardHandler.bind(null, opts));
};

FwapiCLI.prototype.do_rules.help = 'List the rules affecting a VM.';


/**
 * Start the firewall for a VM
 */
FwapiCLI.prototype['do_start'] = function (subcmd, opts, args, callback) {
    if (!args[0]) {
        callback(new Error('Must specify VM UUID'));
        return;
    }

    CONFIG.vmapi.agent = false;
    var vmapi = new VMAPI(CONFIG.vmapi);
    vmapi.updateVm({ payload: { firewall_enabled: true }, uuid: args[0] },
        standardHandler.bind(null, opts));
};

FwapiCLI.prototype['do_start'].help = 'Start a VM\'s firewall';


/**
 * Stop the firewall for a VM
 */
FwapiCLI.prototype['do_stop'] = function (subcmd, opts, args, callback) {
    if (!args[0]) {
        callback(new Error('Must specify VM UUID'));
        return;
    }

    CONFIG.vmapi.agent = false;
    var vmapi = new VMAPI(CONFIG.vmapi);
    vmapi.updateVm({ payload: { firewall_enabled: false }, uuid: args[0] },
        standardHandler.bind(null, opts));
};

FwapiCLI.prototype['do_stop'].help = 'Stop a VM\'s firewall';


/**
 * Lists VMs affected by a rule
 */
FwapiCLI.prototype.do_vms = function (subcmd, opts, args, callback) {
    if (!args[0]) {
        return callback(new Error('Error: must supply rule UUID!'));
    }

    return this.fwapi.getRuleVMs(args[0], getKeyValParams(args, 1),
        standardHandler.bind(null, opts));
};

FwapiCLI.prototype.do_vms.help = 'List the VMs affecting a rule.';


/**
 * Resolve targets into rules
 */
FwapiCLI.prototype.do_resolve = function (subcmd, opts, args, callback) {
    var self = this;
    cli.getPayload(opts, args, function (err, payload) {
        if (err) {
            return callback(err);
        }

        return self.fwapi.post('/resolve', payload,
            standardHandler.bind(null, opts));
    });
};

FwapiCLI.prototype.do_resolve.help = 'Resolve firewall targets into rules.';


/**
 * Create a VM update
 */
FwapiCLI.prototype['do_update-post'] = function (subcmd, opts, args, callback) {
    var self = this;
    cli.getPayload(opts, args, function (err, payload) {
        if (err) {
            return callback(err);
        }

        return self.fwapi.post('/updates', payload,
            standardHandler.bind(null, opts));
    });
};

FwapiCLI.prototype['do_update-post'].help = 'Post a raw VM update';


/**
 * Create a VM update
 */
FwapiCLI.prototype['do_update-vm'] = function (subcmd, opts, args, callback) {
    var self = this;
    if (!args[0]) {
        callback(new Error('Must specify VM UUID'));
        return;
    }

    CONFIG.vmapi.agent = false;
    var vmapi = new VMAPI(CONFIG.vmapi);
    vmapi.getVm({ uuid: args[0] }, function (err, vm) {
        if (err) {
            return callback(err);
        }

        var update = {
            uuid: vm.uuid,
            nics: vm.nics,
            server_uuid: vm.server_uuid,
            tags: vm.tags,
            type: 'vm.update'
        };

        return self.fwapi.post('/updates', update,
            standardHandler.bind(null, opts));
    });
};

FwapiCLI.prototype['do_update-vm'].help =
    'Push a VM update with current data from VMAPI';


cmdln.main(FwapiCLI);
