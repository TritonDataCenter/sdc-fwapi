/*
 * Copyright 2012 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for firewall rules
 */

var clone = require('clone');
var filter = require('../ufds/filter');
var fw = require('../fwrule');
var FwRule = fw.FwRule;
var restify = require('restify');
var ufdsmodel = require('../ufds/ufdsmodel');
var util = require('util');



// --- Internal helpers



function populateConstructorData(req, data) {
  if (req._datacenter) {
    data.datacenter = req._datacenter;
  }
  data.user = req.params.owner_uuid;
}


/**
 * Validate shared request params
 */
function validateReqParams(req, res, next) {
  // XXX: Do we actually want to limit this?
  if (!req.params.owner_uuid) {
    return next(new restify.MissingParameterError(
          '"owner_uuid" parameter required'));
  }

  return next();
}



// --- Restify handlers



/**
 * GET /rules
 */
function listRules(req, res, next) {
  var ruleFilter;
  try {
    ruleFilter = filter.rules(req.params, req.log);
  } catch (err) {
    return next(err);
  }

  return ufdsmodel.requestListFiltered(req, res, next, FwRule, ruleFilter);
}


/**
 * GET /rules/:fwrule
 */
function getRule(req, res, next) {
  return ufdsmodel.requestGet(req, res, next, FwRule);
}


/**
 * POST /rules/:fwrule
 */
function createRule(req, res, next) {
  if (!req.params.rule) {
    return next(new restify.MissingParameterError(
          '"rule" parameter required'));
  }

  req.params.datacenter = req._datacenter;
  var rule;

  try {
    rule = new FwRule(req.params);
  } catch (err) {
    return next(err);
  }

  var params = {
    dn: rule.dn,
    target: 'add-' + rule.id,
    tags: rule.allTags(),
    task: 'add',
    rule: rule.serialize(),
    ufdsRaw: clone(rule.raw),
    vms: rule.allMachines()
  };

  req._wfapi.createJob('add', params, function (err, job) {
    if (err) {
      return next(err);
    }

    req.log.debug({ params: params, job: job },
      'Add job "%s" queued for rule "%s"', job.uuid, params.ufdsRaw.fwrule);

    res.send(202, {
      job_uuid: job.uuid,
      rule: rule.serialize()
    });

    return next();
  });
}


/**
 * PUT /rules/:fwrule
 */
function updateRule(req, res, next) {
  var dn;
  req.params.datacenter = req._datacenter;
  req.params.user = req.params.owner_uuid;

  try {
    dn = FwRule.dnFromRequest(req);
  } catch (err) {
    req.log.error(err, 'Error creating <FwRule> dn');
    return next(err);
  }

  // We need to do a get first in case we don't have the rule text, which is
  // used to determine the machines and tags so that we know what servers to
  // send to
  ufdsmodel.modelGet(req._app, FwRule, dn, req.log, function (err, rule) {
    var machines = {};
    var tags = {};

    // We need a list of all tags before and after (in case we've updated a
    // rule so that it removes them)
    rule.allTags().forEach(function (t) {
      tags[t] = 1;
    });
    rule.allMachines().forEach(function (m) {
      machines[t] = 1;
    });

    var newRule;
    try {
      newRule = new FwRule(clone(req.params));
    } catch (e) {
      return next(e);
    }

    newRule.allTags().forEach(function (t) {
      tags[t] = 1;
    });
    newRule.allMachines().forEach(function (m) {
      machines[t] = 1;
    });

    var params = {
      dn: dn,
      rule: newRule.serialize(),
      tags: Object.keys(tags),
      target: 'update-' + newRule.id,
      task: 'update',
      ufdsRaw: clone(newRule.raw),
      vms: Object.keys(machines)
    };

    req._wfapi.createJob('update', params, function (err, job) {
      if (err) {
        return next(err);
      }

      req.log.debug({ params: params, job: job },
        'Update job "%s" queued for rule "%s"', job.uuid, req.params.fwrule);

      res.send(200, {
        job_uuid: job.uuid
      });

      return next();
    });
  });

}


/**
 * DELETE /rules/:fwrule
 */
function deleteRule(req, res, next) {
  var dn;
  req.params.datacenter = req._datacenter;

  try {
    dn = FwRule.dnFromRequest(req);
  } catch (err) {
    req.log.error(err, 'Error creating <FwRule> dn');
    return next(err);
  }

  ufdsmodel.modelGet(req._app, FwRule, dn, req.log, function (err, rule) {
    var params = {
      dn: dn,
      rule: rule.serialize(),
      tags: rule.allTags(),
      target: 'del-' + rule.id,
      task: 'del',
      vms: rule.allMachines()
    };

    req._wfapi.createJob('del', params, function (err, job) {
      if (err) {
        return next(err);
      }

      req.log.debug({ params: params, job: job },
        'Del job "%s" queued for rule "%s"', job.uuid, req.params.fwrule);

      res.send(200, {
        job_uuid: job.uuid
      });

      return next();
    });
  });
}



// --- Exports



/**
 * Registers endpoints with a restify server
 */
function register(server, before) {
  var userRequired = before.concat(validateReqParams);

  server.get({ path: '/rules', name: 'listRules' }, before, listRules);
  server.post({ path: '/rules', name: 'createRule' }, userRequired,
      createRule);
  server.put({ path: '/rules/:fwrule', name: 'updateRule' },
      userRequired, updateRule);
  server.get({ path: '/rules/:fwrule', name: 'getRule' }, userRequired,
      getRule);
  server.del({ path: '/rules/:fwrule', name: 'deleteRule' },
      userRequired, deleteRule);
}



module.exports = {
  register: register
};
