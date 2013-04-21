/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * The Firewall API control application
 */

var assert = require('assert-plus');
var cli = require('./cli');
var cmdln = require('cmdln');
var fs = require('fs');
var FWAPI = require('sdc-clients').FWAPI;
var path = require('path');
var util = require('util');
var workflow = require('./util/workflow');



// --- Globals


var CONFIG;
var FILE_OPT = {
    names: ['file', 'f'],
    type: 'string',
    help: 'Input file with rule'
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
        if (split.length != 2) {
            errs.push(args[i]);
            continue;
        }
        params[split[0]] = split[1];
    }

    if (errs.length != 0) {
        exit('Invalid parameter%s: %s',
                (errs.length == 1 ? '' : 's'), errs.join(', '));
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

    if (!obj.hasOwnProperty('job_uuid') || !CONFIG.hasOwnProperty('wfapi')) {
        return console.log(cli.json(obj));
    }

    if (VERBOSE) {
        console.log('Job UUID: %s', obj.job_uuid);
    }

    var waitOpts = {
        url: CONFIG.wfapi.url,
        uuid: obj.job_uuid
    };

    workflow.waitForJob(waitOpts, function (err2, res2) {
        if (err2) {
            if (res2 && res2.chain_results) {
                console.log(cli.json(res2.chain_results));
            }

            return cli.exitWithErr(err2, opts);
        }

        if (VERBOSE || (opts && opts.json)) {
            console.log(cli.json(res2.chain_results));
        }

        if (obj.rule) {
            return console.log(cli.json(obj.rule));
        }
    });
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
        {
                names: ['enable', 'e'],
                type: 'bool',
                help: 'Enable the rule'
        },
        FILE_OPT
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
        {
                names: ['enable', 'e'],
                type: 'bool',
                help: 'Enable the rule'
        },
        FILE_OPT
];


/**
 * Enables or disables a firewall depending on subcmd
 */
function enableDisable(subcmd, opts, args, callback) {
    if (!args[0]) {
        return callback(new Error('Error: must supply rule UUID!'));
    }

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
    return this.fwapi.ping(standardHandler.bind(null, opts));
};

FwapiCLI.prototype.do_ping.help = 'Check the status of the API.';


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


cmdln.main(FwapiCLI);
