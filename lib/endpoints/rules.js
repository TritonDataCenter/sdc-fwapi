/*
 * Copyright 2013 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for firewall rules
 */

var clone = require('clone');
var filter = require('../ufds/filter');
var Rule = require('../fwrule').Rule;
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
  // XXX: validate :uuid, enabled here

  /*
  if (!req.params.owner_uuid) {
    return next(new restify.MissingParameterError(
          '"owner_uuid" parameter required'));
  }
  */

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

  return ufdsmodel.requestListFiltered(req, res, next, Rule, ruleFilter);
}


/**
 * GET /rules/:uuid
 */
function getRule(req, res, next) {
  return ufdsmodel.requestGet(req, res, next, Rule);
}


/**
 * POST /rules/:uuid
 */
function createRule(req, res, next) {
  if (!req.params.rule) {
    return next(new restify.MissingParameterError(
          '"rule" parameter required'));
  }

  req.params.datacenter = req._datacenter;
  var rule;

  try {
    rule = new Rule(req.params);
  } catch (err) {
    return next(err);
  }

  var params = {
    dn: rule.dn,
    target: 'add-' + rule.uuid,
    fwapiTags: rule.tags,
    task: 'add',
    rule: rule.serialize(),
    ufdsRaw: clone(rule.raw()),
    fwapiVMs: rule.vms
  };

  req._wfapi.createJob('add', params, function (err, job) {
    if (err) {
      return next(err);
    }

    req.log.debug({ params: params, job: job },
      'Add job "%s" queued for rule "%s"', job.uuid, params.ufdsRaw.uuid);

    res.send(202, {
      job_uuid: job.uuid,
      rule: rule.serialize()
    });

    return next();
  });
}


/**
 * PUT /rules/:uuid
 */
function updateRule(req, res, next) {
  var dn;
  req.params.datacenter = req._datacenter;
  req.params.user = req.params.owner_uuid;

  try {
    dn = Rule.dnFromRequest(req);
  } catch (err) {
    req.log.error(err, 'Error creating <Rule> dn');
    return next(err);
  }

  // We need to do a get first in case we don't have the rule text, which is
  // used to determine the vms and tags so that we know what servers to
  // send to
  ufdsmodel.modelGet(req._app, Rule, dn, req.log, function (err, rule) {
    var vms = {};
    var tags = {};

    // We need a list of all tags before and after (in case we've updated a
    // rule so that it removes them)
    rule.tags.forEach(function (t) {
      tags[t] = 1;
    });
    rule.vms.forEach(function (v) {
      vms[v] = 1;
    });

    var newRule;
    var updateParams = clone(rule.serialize());
    for (var p in req.params) {
      updateParams[p] = req.params[p];
    }

    try {
      newRule = new Rule(updateParams);
    } catch (e) {
      return next(e);
    }

    newRule.tags.forEach(function (t) {
      tags[t] = 1;
    });
    newRule.vms.forEach(function (v) {
      vms[v] = 1;
    });

    var params = {
      dn: dn,
      rule: newRule.serialize(),
      fwapiTags: Object.keys(tags),
      target: 'update-' + newRule.uuid,
      task: 'update',
      ufdsRaw: clone(newRule.raw()),
      fwapiVMs: Object.keys(vms)
    };

    req._wfapi.createJob('update', params, function (err, job) {
      if (err) {
        return next(err);
      }

      req.log.debug({ params: params, job: job },
        'Update job "%s" queued for rule "%s"', job.uuid, req.params.uuid);

      res.send(200, {
        job_uuid: job.uuid
      });

      return next();
    });
  });

}


/**
 * DELETE /rules/:uuid
 */
function deleteRule(req, res, next) {
  var dn;
  req.params.datacenter = req._datacenter;

  try {
    dn = Rule.dnFromRequest(req);
  } catch (err) {
    req.log.error(err, 'Error creating <Rule> dn');
    return next(err);
  }

  ufdsmodel.modelGet(req._app, Rule, dn, req.log, function (err, rule) {
    if (err) {
      return next(err);
    }

    var params = {
      dn: dn,
      rule_uuid: rule.uuid,
      fwapiTags: rule.tags,
      target: 'del-' + rule.uuid,
      task: 'del',
      fwapiVMs: rule.vms
    };

    req._wfapi.createJob('del', params, function (err, job) {
      if (err) {
        return next(err);
      }

      req.log.debug({ params: params, job: job },
        'Del job "%s" queued for rule "%s"', job.uuid, req.params.uuid);

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
  server.put({ path: '/rules/:uuid', name: 'updateRule' },
      userRequired, updateRule);
  server.get({ path: '/rules/:uuid', name: 'getRule' }, userRequired,
      getRule);
  server.del({ path: '/rules/:uuid', name: 'deleteRule' },
      userRequired, deleteRule);
}



module.exports = {
  register: register
};
