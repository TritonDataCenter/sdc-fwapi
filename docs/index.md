---
title: Firewall API (FWAPI)
markdown2extras: tables, code-friendly
apisections: Rules, Firewalls
---
<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2015, Joyent, Inc.
-->

# FWAPI (Firewall API)

This is the reference documentation for FWAPI, the Firewall API for
SmartDataCenter (SDC).



# Overview

## Design principles

The FWAPI design principles are:

* It should be easy to manage rules for large numbers of machines easily -
  you should never have to manage the same rule for a number of machines.
* Managing these rules should be made easier using the VM's metadata
  (eg: tags)
* The firewall should live outside of the VM: it should be as if the VM is
  connected to its own physical firewall sitting between it and the rest of
  the world.
* Updating firewall rules should happen out of band - it should be
  impossible to lock out whatever's doing the updating.
* Updates should happen as instantaneously as possible, and should not
  require rebooting of the VM.

For more information about the implementation and various pieces of the
firewalling system, consult the
[architecture and troubleshooting guide](architecture.html).

See also the [examples](examples.html) for some common use-cases.

## Default Policy

The default policy for a VM with its firewall enabled is:

* block all inbound traffic
* allow all outbound traffic

This default policy cannot be changed - you must add rules that get applied
in addition to these defaults.


## Rules

Important things to remember:

* Rules are not necessarily per instance.
* Rather, one rule can affect many VMs through the **tags** or **all vms**
  targets.
* All user rules are tied to that users' owner_uuid, which restricts the
  rules to VMs that they own.
* The exception is global rules - these are set by the administrator, and
  will apply to all VMs in the datacenter (not just for a particular owner).
  There is currently only one of these enabled by default, which allows
  pings from any host.
* Rules can be individually enabled or disabled.

In the case of two rules that affect the same VM and port, the rule that
goes counter to the default policy takes precedence.  This means:

* If you have an incoming BLOCK and an incoming ALLOW rule for the
  same VM and port, the ALLOW will override.
* If you have an outgoing BLOCK and an outgoing ALLOW rule for the
  same VM and port, the BLOCK will override.


## VMs

Important things to remember:

* Firewall rules only affect a VM if it has the **firewall_enabled**
  property set to **true**.
* Updating tags on the VMs will affect what rules are applied to the VM.
* FWAPI firewall rules only work on **KVM** VMs running on server platform_version newer than **20140314**.
* FWAPI firewall rules work on all SmartOS VMs.

## An Example

Say you are running a website - you have a number of web servers that make
connections to a number of database servers.  You want the following
firewall behaviour:

* Anyone on the internet can speak HTTP and HTTPS to the webservers
* Webservers *only* can speak to the database servers on the database port
* Webservers and database servers can SSH to each other


To implement this in FWAPI, you would first add three rules:

**"Anyone on the internet can speak HTTP and HTTPS to the webservers":**

    FROM any TO tag www ALLOW tcp port (80 and 443)


**"Webservers *only* can speak to the database servers on the database port":**

    FROM tag www TO tag db ALLOW tcp port 5432


**"Webservers and database servers can SSH to each other":**

    FROM all vms to all vms ALLOW tcp port 22

"all vms" here means "all VM instances that are owned by that user"


There are two more steps necessary:

* Updating all webserver VMs with tag **www**
* Updating all database VMs with tag **db**

Please see the [examples](examples.html) page for more examples.

# Rule Syntax

Rules are written in a Doman Specific Language (DSL). References for it are:

* The [rule syntax guide](rules.html) has the complete syntax.
* The [railroad diagram](railroad-diagram.xhtml) has an easier to read
  format.
* The [cloudapi firewall rules documentation](http://wiki.joyent.com/wiki/display/jpc2/Firewall+Rules)
  is probably much clearer.


# Rules

These endpoints manage firewall rules.


## ListRules (GET /rules)

Returns a list of all rules.

### Inputs

All inputs are optional.  Fields with *Filter* in the description will filter
the rules returned.  They will match rules with these targets in either the
FROM or TO side of the rule.

| Field      | Type             | Description                    |
| ---------- | ---------------- | ------------------------------ |
| fields     | Array of Strings | List of extra fields to return |
| ip         | String           | Filter: IP                     |
| owner_uuid | UUID             | Filter: Owner UUID             |
| subnet     | String           | Filter: Subnet CIDR            |
| tag        | String           | Filter: Tag                    |
| vm         | UUID             | Filter: VM UUID                |

The `fields` parameter controls additional fields that will be returned.
Valid fields are:

| Field           | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| parsed.action   | The rule's action: `block` or `allow` (in the `parsed` object) |
| parsed.ports    | Ports the rule affects (in the `parsed` object)                |
| parsed.protocol | Rule protocol (in the `parsed` object)                         |
| parsed.tags     | Rule tags (in the `parsed` object)                             |


### Example: list all rules belonging to a specific owner_uuid

    GET /rules
        -d owner_uuid=930896af-bf8c-48d4-885c-6573a94b1853

    [
        {
          "description": "allow pings to all VMs",
          "enabled": true,
          "global": true,
          "rule": "FROM any TO all vms ALLOW icmp TYPE 8 CODE 0",
          "uuid": "27775f65-d377-4979-9c7c-63c9d4f98525",
          "version": "1386743867795.003240"
        },
        {
          "description": "One new rule",
          "enabled": true,
          "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
          "rule": "FROM (ip 10.99.99.254 OR ip 10.99.99.7) TO vm dfbcc139-990f-4b49-bb62-d3d6bd2fd52d ALLOW tcp PORT 559",
          "uuid": "d92dcf67-a74b-4fda-9019-82a5d74af551",
          "version": "1386898045802.093012"
        }
    ]


## GetRule (GET /rules/:uuid)

Returns a rule.

| Field      | Type | Description                                                               |
| ---------- | ---- | ------------------------------------------------------------------------- |
| owner_uuid | UUID | If set, will not return the rule unless its owner_uuid matches (optional) |

### Example: get a rule

    GET /rules/d92dcf67-a74b-4fda-9019-82a5d74af551

    {
      "description": "One new rule",
      "enabled": true,
      "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "rule": "FROM (ip 10.99.99.254 OR ip 10.99.99.7) TO vm dfbcc139-990f-4b49-bb62-d3d6bd2fd52d ALLOW tcp PORT 559",
      "uuid": "d92dcf67-a74b-4fda-9019-82a5d74af551",
      "version": "1386898045802.093012"
    }


## UpdateRule (PUT /rules/:uuid)

Modifies a rule.

### Inputs

| Field       | Type    | Description                                                            |
| ----------- | ------- | ---------------------------------------------------------------------- |
| description | String  | Rule description (optional)                                            |
| enabled     | Boolean | Whether or not the rule is enabled (optional, default: false)          |
| global      | Boolean | Whether or not the rule is global (optional)                           |
| owner_uuid  | UUID    | Owner UUID of the rule (optional)                                      |
| rule        | String  | The firewall rule (see the [rule syntax guide](rules.html)) (optional) |

*Note:* One of global or owner_uuid is required.

### Example: disable a rule

    PUT /rules/42859d04-c0f1-47d1-910e-382ffe07d029
        -d enabled=false

    {
      "description": "One new rule",
      "enabled": false,
      "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "rule": "FROM (ip 10.99.99.254 OR ip 10.99.99.7) TO vm dfbcc139-990f-4b49-bb62-d3d6bd2fd52d ALLOW tcp PORT 559",
      "uuid": "d92dcf67-a74b-4fda-9019-82a5d74af551",
      "version": "1386898045802.093012"
    }


## GetRuleVMs (GET /rules/:uuid/vms)

Returns the VMs affected by a rule.

### Inputs

| Field      | Type | Description                 |
| ---------- | ---- | --------------------------- |
| owner_uuid | UUID | Owner UUID to filter VMs by |

### Example: get the UUIDs of VMs affected by a rule

    GET /rules/fb5ad3b7-9602-43c8-b286-8a7c0627a438/vms | json -a uuid
        2a832664-a9b5-40e7-b1bf-43ad90ac4172
        2ca7d243-215f-41d7-a8ed-c83e4712a8bf


## CreateRule (POST /rules)

Creates a rule.

### Inputs

| Field       | Type    | Description                                                            |
| ----------- | ------- | ---------------------------------------------------------------------- |
| description | String  | Rule description (optional)                                            |
| enabled     | Boolean | Whether or not the rule is enabled (optional, default: false)          |
| global      | Boolean | Whether or not the rule is global (optional)                           |
| owner_uuid  | UUID    | Owner UUID of the rule (optional)                                      |
| rule        | String  | The firewall rule (see the [rule syntax guide](rules.html)) (optional) |

*Note:* One of global or owner_uuid is required.

### Example: create a rule

    POST /rules
        -d description="One new rule"
        -d enabled=true
        -d owner_uuid=930896af-bf8c-48d4-885c-6573a94b1853
        -d rule="FROM (ip 10.99.99.254 OR ip 10.99.99.7) TO vm dfbcc139-990f-4b49-bb62-d3d6bd2fd52d ALLOW tcp PORT 559"

    {
      "description": "One new rule",
      "enabled": true,
      "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "rule": "FROM (ip 10.99.99.254 OR ip 10.99.99.7) TO vm dfbcc139-990f-4b49-bb62-d3d6bd2fd52d ALLOW tcp PORT 559",
      "uuid": "d92dcf67-a74b-4fda-9019-82a5d74af551",
      "version": "1386898045802.093012"
    }


## DeleteRule (DELETE /rules/:uuid)

Deletes a rule.

### Inputs

| Field      | Type | Description                                                               |
| ---------- | ---- | ------------------------------------------------------------------------- |
| owner_uuid | UUID | If set, will not delete the rule unless its owner_uuid matches (optional) |

### Example: delete a rule

    DELETE /rules/42859d04-c0f1-47d1-910e-382ffe07d029
        -d owner_uuid=930896af-bf8c-48d4-885c-6573a94b1853

    {}



# Firewalls

These endpoints display the firewall rules that apply to VMs.


## GetVMrules (GET /firewalls/vms/:uuid)

Returns the rules that apply to a VM.

### Inputs

| Field      | Type | Description                       |
| ---------- | ---- | --------------------------------- |
| owner_uuid | UUID | Owner UUID of the rule (optional) |

### Example: get the rules that apply to VM 2ca7d243-215f-41d7-a8ed-c83e4712a8bf

    GET /firewalls/vms/2ca7d243-215f-41d7-a8ed-c83e4712a8bf

    [
        {
          "description": "allow pings to all VMs",
          "enabled": true,
          "global": true,
          "rule": "FROM any TO all vms ALLOW icmp TYPE 8 CODE 0",
          "uuid": "27775f65-d377-4979-9c7c-63c9d4f98525",
          "version": "1386743867795.003240"
        },
        {
          "enabled": true,
          "owner_uuid": "e6fcbc64-3f32-11e2-a144-bf78292e9628",
          "rule": "FROM ip 10.88.88.2 TO tag tag2 ALLOW tcp PORT 80",
          "uuid": "fb5ad3b7-9602-43c8-b286-8a7c0627a438",
          "version": "1362178611215.099554"
        }
    ]



# Resolve

This is an internal API endpoint used by the firewaller agent to fetch
rules from the API.  **Its interface is unstable and for internal use only.**

## Resolve (POST /resolve)

This endpoint is used by the firewaller agent to fetch rules and assist with
determining which remote VMs need to be transfered to a Compute Node.  It is
intended to resolve the following information:

For a given set of VMs that have a certain set of tags,

* What firewall rules apply to those VMs?
* What data do I need to request from VMAPI to retrieve VMs on other Compute
  Nodes that are targets of those rules?

### Inputs

| Field      | Type           | Description                          |
| ---------- | -------------- | ------------------------------------ |
| owner_uuid | UUID           | Owner UUID of the rule (required)    |
| vms        | Array of UUIDs | VM UUIDs to query (optional)         |
| tags       | Object         | Tag key / values to query (optional) |

### Example: get the rules that apply to VM 2ca7d243-215f-41d7-a8ed-c83e4712a8bf

    POST /resolve -d '
    {
      "owner_uuid": "98c2d1f4-66f4-468c-97ff-4b19c5d9ab22",
      "tags": {
        "foo": [ "bar", "blah" ]
      },
      "vms": [ "b3073275-3c07-44ed-9e20-4c4fe3bb1e7f" ]
    }'

    {
      "rules": [
        {
          "enabled": false,
          "owner_uuid": "98c2d1f4-66f4-468c-97ff-4b19c5d9ab22",
          "rule": "FROM (tag foo = bar OR tag foo = baz) TO tag other ALLOW tcp PORT 53",
          "uuid": "fe1a83d9-2925-4c31-8b5d-ced893521a84",
          "version": "1407839134259.054114"
        },
        {
          "enabled": false,
          "owner_uuid": "98c2d1f4-66f4-468c-97ff-4b19c5d9ab22",
          "rule": "FROM (tag role = db OR tag role = www) TO tag foo = blah ALLOW tcp PORT 54",
          "uuid": "e0f3de04-d10e-4f54-9625-393196e66b69",
          "version": "1408036607587.069377"
        },
        {
          "description": "allow pings to all VMs",
          "enabled": true,
          "global": true,
          "rule": "FROM any TO all vms ALLOW icmp TYPE 8 CODE 0",
          "uuid": "34db1b5a-4097-4c91-b2bc-291b6efe67c0",
          "version": "1407798898407.030641"
        },
        {
          "enabled": true,
          "owner_uuid": "98c2d1f4-66f4-468c-97ff-4b19c5d9ab22",
          "rule": "FROM tag something TO vm b3073275-3c07-44ed-9e20-4c4fe3bb1e7f ALLOW tcp PORT 8080",
          "uuid": "7cf05767-74a9-4f22-a224-08eb54c935dd",
          "version": "1408036482005.069377"
        }
      ],
      "tags": {
        "role": [ "db", "www" ],
        "something": true
      },
      "vms": [],
      "allVMs": false,
      "owner_uuid": "98c2d1f4-66f4-468c-97ff-4b19c5d9ab22"
    }


In the response above:

* *rules* is the list of rules that apply to that set of VMs and tags.
* *tags* is a mapping of tag key / values to retrieve.  If a key is set to true,
  all VMs that have a tag with that name need to be retrieved, regardless of
  the tag's value. If set to an array of values, tags with that name and
  the values in the array need to be retrieved.
* *vms* is a list of VM UUIDs to retrieve.
* *allVMs* indicates that all VMs from this owner need to be retrieved.

Note that the values returned effectively form an OR query, so for the example
above, we need to retrieve VMs with (tag role = db) OR (role = www) OR (tag
something).



# Changelog

## 2013-03-01

- Added [GetVMrules](#GetVMrules) endpoint.
- Added [GetRuleVMs](#GetRuleVMs) endpoint.

## 2013-12-12

- [GetRuleVMs](#GetRuleVMs): `owner_uuid` is no longer optional.

## 2013-12-16

- [CreateRule](#CreateRule) and [UpdateRule](#UpdateRule) now require the
  `global` parameter if `owner_uuid` is not set.

## 2015-03-23

- Added `fields` option to the [ListRules](#ListRules) endpoint.
