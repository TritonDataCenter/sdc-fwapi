/*
 * Copyright 2013 Joyent, Inc.  All rights reserved.
 *
 * Restify handlers for firewall rules
 */

var clone = require('clone');
var common = require('./common');
var filter = require('../ufds/filter');
var mod_err = require('../errors');
var restify = require('restify');
var Rule = require('../rule').Rule;
var ufdsmodel = require('../ufds/ufdsmodel');
var util = require('util');



// --- Internal helpers



/**
 * Turns a fwrule error into an InvalidParamsError
 */
function createParamErr(err) {
  if (!err.hasOwnProperty('ase_errors') && !err.hasOwnProperty('field')) {
    return err;
  }

  var errs = err.hasOwnProperty('ase_errors') ? err.ase_errors : [ err ];
  return new mod_err.InvalidParamsError(mod_err.INVALID_MSG,
    errs.map(function (e) {
      return mod_err.invalidParam(e.field, e.message);
    }));
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

  var rule;

  try {
    rule = new Rule(req.params);
  } catch (err) {
    return next(createParamErr(err));
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
  var dn = req._dn;
  var newRule;
  var rule = req._rule;
  var vms = {};
  var tags = {};
  var updateParams = clone(rule.serialize());

  // We need a list of all tags before and after (in case we've updated a
  // rule so that it removes them)
  rule.tags.forEach(function (t) {
    tags[t] = 1;
  });
  rule.vms.forEach(function (v) {
    vms[v] = 1;
  });

  for (var p in req.params) {
    updateParams[p] = req.params[p];
  }

  // Don't allow updating the rule's UUID
  delete req.params.uuid;

  try {
    newRule = new Rule(updateParams);
  } catch (e) {
    return next(createParamErr(e));
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

    res.send(202, {
      job_uuid: job.uuid,
      rule: newRule.serialize(),
    });

    return next();
  });
}


/**
 * DELETE /rules/:uuid
 */
function deleteRule(req, res, next) {
  var dn = req._dn;
  var rule = req._rule;

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
}



// --- Exports



/**
 * Registers endpoints with a restify server
 */
function register(server, before) {
  var matchingOwner = before.concat(common.ruleBefore);

  server.get({ path: '/rules', name: 'listRules' }, before, listRules);
  server.post({ path: '/rules', name: 'createRule' }, before, createRule);
  server.put({ path: '/rules/:uuid', name: 'updateRule' },
      matchingOwner, updateRule);
  server.get({ path: '/rules/:uuid', name: 'getRule' }, before, getRule);
  server.del({ path: '/rules/:uuid', name: 'deleteRule' },
      matchingOwner, deleteRule);
}



module.exports = {
  register: register
};
