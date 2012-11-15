# Firewall API

Repository: <git@git.joyent.com:fwapi.git>
Browsing: <https://mo.joyent.com/fwapi>
Who: Rob Gulewich
Docs: <https://mo.joyent.com/docs/fwapi>
Tickets/bugs: <https://devhub.joyent.com/jira/browse/FWAPI>


# Overview

This is the firewall API.


# Repository

    deps/           Git submodules and/or commited 3rd-party deps should go
                    here. See "node_modules/" for node.js deps.
    docs/           Project docs (restdown)
    lib/            Source files.
    node_modules/   Node.js deps, either populated at build time or commited.
                    See Managing Dependencies.
    pkg/            Package lifecycle scripts
    smf/manifests   SMF manifests
    smf/methods     SMF method scripts
    test/           Test suite (using node-tap)
    tools/          Miscellaneous dev/upgrade/deployment tools and data.
    Makefile
    package.json    npm module info (holds the project version)
    README.md


# Development

To run fwapi:

    git clone git@git.joyent.com:fwapi.git
    cd fwapi
    git submodule update --init
    make all
    cp config.json.sample config.json
    node server.js

To update the docs, edit "docs/index.restdown" and run `make docs`
to update "docs/index.html".

Before commiting/pushing run `make prepush` and, if possible, get a code
review.


# Testing

    make test

