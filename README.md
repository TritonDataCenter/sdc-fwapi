<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2019 Joyent, Inc.
    Copyright 2024 MNX Cloud, Inc.
-->

# sdc-fwapi

This repository is part of the Triton Data Center project. See the [contribution
guidelines](https://github.com/TritonDataCenter/triton/blob/master/CONTRIBUTING.md)
and general documentation at the main
[Triton project](https://github.com/TritonDataCenter/triton) page.

The SDC Firewall API (FWAPI) allows managing firewall rules for VMs. These
rules are high-level and written in a Domain-Specific Language. For more
information on the rules and system design, see:

* **docs/index.md** for an overview
* **docs/architecture.md** for how rules are managed
* The [sdc-fwrule repo](http://github.com/TritonDataCenter/sdc-fwrule)
* [examples.md](https://github.com/TritonDataCenter/sdc-fwrule/blob/master/docs/examples.md) and
  [rules.md](https://github.com/TritonDataCenter/sdc-fwrule/blob/master/docs/rules.md)
  in the sdc-fwrule repo

The contents of this repo are bundled up into an image that is then provisioned
as the fwapi zone in SDC.

# Repository

    bin/                CLI tools
    boot/               Shell scripts for booting and configuring the zone
    deps/               Git submodules
    docs/               Project docs (restdown)
    lib/                Source files.
    node_modules/       node.js dependencies - not checked in, but installed
                        with `npm install`
    sapi_manifests/     Service API (SAPI) manifests
    smf/manifests       SMF manifests
    smf/methods         SMF method scripts
    test/               Test suites (using nodeunit)
        integration/    Integration tests (to be run in a deployed fwapi zone)
        unit/           Unit tests (to be run in your development environment)
    tools/              Miscellaneous dev tools
    Makefile
    package.json        npm module info (holds the project version)
    README.md
    server.js           API server main entry point


# Development

To get started:

    git clone git@github.com:TritonDataCenter/sdc-fwapi.git
    make

To update the docs, edit "docs/index.md", then check that
"docs/index.html" gets updated properly by running:

    make docs

To run style and lint checks:

    make check

To run all checks and tests:

    make prepush

Before commiting/pushing run `make prepush` and, if possible, get a code
review. For non-trivial changes, a unit or integration test that covers the
new behaviour is required.


# Testing

## Unit tests

To run all tests:

    make test

To run an individual test:

    ./test/runtest ./test/unit/testname.test.js

## Integration tests

To run the integration tests, on a **non-production** SDC server:

    sdc-login fwapi
    /opt/smartdc/fwapi/test/runtests

Or to run an individual integration test:

    /opt/smartdc/fwapi/test/runtest /opt/smartdc/fwapi/test/integration/testname.test.js

Note that there are two types of integration tests:

* Single-server tests end in **.test.js**, and can be run with only a single server in your
  datacenter.
* Multi-server tests end in **.mult-test.js**, and can only be run when there is more than
  one server available in your datacenter.
