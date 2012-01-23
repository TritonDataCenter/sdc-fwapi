/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for retrieving machine rules
 *
 */

var async = require('async');

var ufdsmodel = require('./ufds/ufdsmodel');
var FwRule = require('./fwrule').FwRule;

// TODO: add caching (though not yet, since MAPI is going away soon)



//--- MAPI access methods



// Gets the IPs and tags for machine with the given uuid
function mapiGetMachineData(req, uuid, callback) {
  var log = req._log;
  var mapi = req._app.mapi;
  log.trace("[%s] mapiGetMachineData: start", uuid);

  mapi.getMachine(uuid, function mapiMachine(err, machine) {
    if (err) {
      log.error("[%s] mapiGetMachineData: error: ", uuid, err);
      return callback(err);
    }
    var machineData = { 'ips': {}, 'tags': {} };

    machine.ips.reduce(function(acc, x) { acc[x.address] = 1; return acc; },
      machineData.ips);

    Object.keys(machine.tags).reduce(
      function(acc, x) { acc[x] = {}; return acc; },
      machineData.tags);

    machineData.user = machine.owner_uuid;
    log.trace("[%s] mapiGetMachineData: returning: %s",
      uuid, JSON.stringify(machineData));
    return callback(null, machineData);
  });
}


// Gets the IPs for all machines with the given tags
function mapiGetIPsForTags(req, tags, machineData, callback) {
  var log = req._log;
  var mapi = req._app.mapi;
  var tagsToIPs = {};
  var uuid = req.uriParams.machineuuid;
  log.trace("[%s] mapiGetIPsForTags: start", uuid);

  if (Object.keys(tags).length == 0) {
    log.debug("[%s] mapiGetIPsForTags: no tags - returning", uuid);
    return callback(null, {});
  }

  var params = {"owner_uuid": machineData.user };
  Object.keys(tags).forEach(function(tag) {
    params["tag." + tag] = '';
    tagsToIPs[tag] = {};
  });

  log.debug("[%s] mapiGetIPsForTags: params=%s", uuid, JSON.stringify(params));

  mapi.listMachines(params, function(err, machines) {
    if (log.debug()) {
      var machineIDs = machines.reduce(function(acc, x) {
        acc.push(x.id); return acc; }, []);
      log.debug("[%s] mapiGetIPsForTags: machines=%s",
        uuid, JSON.stringify(machineIDs));
    }

    if (err) {
      log.error("[%s] mapiGetIPsForTags: error: %s", uuid, err);
      return callback(err);
    }

    machines.forEach(function(machine) {
      machine.ips.forEach(function(ip) {
        Object.keys(machine.tags).forEach(function(tag) {
          if (tags.hasOwnProperty(tag)) {
            tagsToIPs[tag][ip.address] = 1;
          }
        });
      });
    });

    // Now that we've de-duped the IPs, array-ify them
    Object.keys(tagsToIPs).forEach(function(tag) {
      tagsToIPs[tag] = Object.keys(tagsToIPs[tag]).sort();
    });

    log.trace("[%s] mapiGetIPsForTags: returning: %s", uuid, tagsToIPs);
    return callback(null, tagsToIPs);
  });
}


// For the given machine and rules, find any machines on the other side of the
// rule and get the IPs for those machines from MAPI
function mapiRulesToMachineIPs(req, machineData, rules, results, callback) {
  var log = req._log;
  var mapi = req._app.mapi;
  var uuid = req.uriParams.machineuuid;
  log.trace("[%s] mapiRulesToMachineIPs: start", uuid);

  if (Object.keys(rules).length == 0) {
    log.debug("[%s] mapiRulesToMachineIPs: no rules - returning", uuid);
    return callback(null, {});
  }

  var tags = Object.keys(machineData.tags);

  if (log.debug()) {
    var ruleIDs = rules.reduce(function(acc, x) {
      acc.push(x.id); return acc; }, []);
    log.debug("[%s] mapiRulesToMachineIPs: rules=%s",
        uuid, JSON.stringify(ruleIDs));
  }

  // Only lookup IPs for machines that are on the other side of the rule
  // eg: if it's on the FROM side, we only care about addresses on the TO
  // side
  var machines = {};
  rules.forEach(function(rule) {
    var dir = rule.oppositeDirection({'machine': uuid, 'tag': tags});
    log.debug("[%s] mapiRulesToMachineIPs: rule='%s', direction='%s'", uuid, rule.rule, dir);

    if (!dir) {
      // log.warn("machine '%s' not found in rule '%s'", uuid, rule.rule);
      return;
    }
    var ruleMachines = rule.machines();
    ruleMachines[dir].forEach(function(machine) {
      machines[machine] = [];
    });
  });

  log.debug("[%s] mapiRulesToMachineIPs: machines=%s",
      uuid, JSON.stringify(machines));

  if (Object.keys(machines).length == 0) {
    log.debug("[%s] mapiRulesToMachineIPs: no machines found, returning {}",
        uuid);
    return callback(null, {});
  }

  function machineQuery(machine, forEachCallback) {
    mapiGetMachineData(req, machine, function (err, result) {
      log.debug("[%s] mapiRulesToMachineIPs: machine=%s, result=%s",
        uuid, machine, JSON.stringify(result));

      if (err) {
        log.error("[%s] mapiRulesToMachineIPs: machine=%s: error: ",
          uuid, machine, err);
        forEachCallback(err);
      }

      if (result.hasOwnProperty('ips')) {
        machines[machine] = Object.keys(result.ips).sort();
      }
      return forEachCallback(null);
    });
  }

  async.forEach(Object.keys(machines), machineQuery, function(err) {
    if (err) {
      return callback(err);
    }
    log.debug("[%s] mapiRulesToMachineIPs: returning machines=%s",
      uuid, JSON.stringify(machines));
    return callback(null, machines);
  });
}


// For a machine with the given uuid and tags, get the IPs for any tags on the
// opposite side of the rule from MAPI
function mapiGetTagIPsForRules(req, rules, tags, machineData, callback) {
  console.log("mapiGetTagIPsForRules: start");
  var log = req._log;
  var uuid = req.uriParams.machineuuid;
  var tagMap = {};
  log.trace("[%s] mapiGetTagIPsForRules: start", uuid);

  rules.forEach(function(rule) {
    var dir = rule.oppositeDirection({'machine': uuid, 'tag': tags});
    if (!dir) {
      log.warn("machine '%s' (tags: %s) not found in rule '%s'",
        uuid, JSON.stringify(tags), rule.rule);
      return;
    } else {
      var ruleTags = rule.tags();
      log.debug("[%s] mapiGetTagIPsForRules: rule='%s', direction='%s': tags=%s",
        uuid, rule.rule, dir, JSON.stringify(ruleTags));

      ruleTags[dir].forEach(function(tag) {
        tagMap[tag] = 1;
      });
    }
  });

  if (Object.keys(tagMap).length == 0) {
    log.trace("[%s] mapiGetTagIPsForRules: no tags, returning {}", uuid);
    return callback(null, {});
  }

  log.trace("[%s] mapiGetTagIPsForRules: returning %s",
    uuid, JSON.stringify(tagMap));
  return mapiGetIPsForTags(req, tagMap, machineData, callback);
}



//--- UFDS access methods



// Gets datacenter-specific rules from UFDS
function ufdsGetDataCenterRules(req, uuid, callback) {
  var app = req._app;
  var dc = req._datacenter;
  var log = req._log;
  var uuid = req.uriParams.machineuuid;
  var parentDn = FwRule.datacenterDn(dc);
  var filter = '(enabled=true)';
  log.trace("[%s] ufdsGetDataCenterRules: start: dc='%s', parentDn='%s'",
    uuid, dc, parentDn);

  ufdsmodel.modelListFiltered(app, FwRule, parentDn, filter, log, function (err, items) {
    console.log("ufdsGetDataCenterRules:modelList cb");
    if (err) {
      log.error("[%s] ufdsGetDataCenterRules: error: ", uuid, err);
      return callback(err);
    }

    log.trace("[%s] ufdsGetDataCenterRules: returning %s",
      uuid, JSON.stringify(items));
    return callback(null, items);
  });
}


// Gets rules for a machine from UFDS
function ufdsGetMachineRules(req, uuid, machineData, callback) {
  var app = req._app;
  var log = req._log;
  var parentDn = FwRule.parentDn(machineData.user);
  var filter = [ '(&', '(enabled=true)',
    '(|', '(frommachine=' + uuid + ')', '(tomachine=' + uuid + ')'];

  if (machineData.tags) {
    Object.keys(machineData.tags).forEach(function(tag) {
      filter.push('(fromtag=' + tag + ')');
      filter.push('(totag=' + tag + ')');
    });
  }
  filter.push(')');
  filter.push(')');
  var filterTxt = filter.join('');

  log.debug("[%s] ufdsGetMachineRules: start: parentDn='%s', filter='%s'",
    uuid, parentDn, filterTxt);

  ufdsmodel.modelListFiltered(app, FwRule, parentDn, filterTxt, log, function (err, items) {
    if (err) {
      log.error("[%s] ufdsGetMachineRules: error: %s", uuid, err);
      return callback(err);
    }

    if (log.debug()) {
      var ruleIDs = items.reduce(function(acc, x) {
        acc.push(x.id); return acc; }, []);
      log.debug("[%s] ufdsGetMachineRules: returning rules: %s",
        uuid, JSON.stringify(ruleIDs));
    }
    return callback(null, items);
  });
}



//--- restify handlers



// Returns all data necessary to firewall the given machine:
// * All rules that apply to that machine or its tags
// * The machine's tags
// * IPs for machines mentioned in the rules
// * IPs for tags mentioned in the rules
function machineData(req, res, next) {
  var machine = req.uriParams.machineuuid;

  async.auto({
    // Get datacenter-wide rules
    ufdsGetDataCenterRules: function(callback) {
      ufdsGetDataCenterRules(req, machine, callback);
    },
    // Get tags and IPs for the machine
    mapiGetMachineData: function(callback) {
      mapiGetMachineData(req, machine, callback);
    },
      // Get all the rules matching this machine and its tags
      ufdsGetMachineRules: ['mapiGetMachineData', function(callback, results) {
        ufdsGetMachineRules(req, machine, results.mapiGetMachineData, callback);
      }],
        // Get IPs for machines mentioned in the rules
        mapiRulesToMachineIPs: ['ufdsGetMachineRules', function(callback, results) {
          mapiRulesToMachineIPs(req, results.mapiGetMachineData,
            results.ufdsGetMachineRules, results, callback);
        }],
        // Get IPs for tags mentioned in the rules
        mapiGetTagIPsForRules: ['ufdsGetMachineRules', function(callback, results) {
          mapiGetTagIPsForRules(req, results.ufdsGetMachineRules,
            Object.keys(results.mapiGetMachineData.tags),
            results.mapiGetMachineData, callback);
        }]

  }, function assemblePayload(err, results) {
    req._log.trace('machineData: assemblePayload entered');

    if (err) {
      res.sendError(err);
      return next();
    }

    var data = {
      'tags': Object.keys(results.mapiGetMachineData.tags),
      'tag_ips': results.mapiGetTagIPsForRules,
      'machines': results.mapiRulesToMachineIPs,
      'rules': []
    };

    function serializeRule(r) {
      var serialized = r.serialize();
      delete(serialized.enabled);
      data.rules.push(serialized);
    }
    results.ufdsGetDataCenterRules.forEach(serializeRule);
    results.ufdsGetMachineRules.forEach(serializeRule);

    res.send(200, data);
    return next();
  });
}


function registerHandlers(server, before, after) {
  server.get('/machines/:machineuuid', before, machineData, after);
}


module.exports = {
  registerHandlers: registerHandlers,
  machineData: machineData
};
