#!/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

INSTDIR=/opt/smartdc/fwapi
CONF=${INSTDIR}/config.json

echo "Importing fwapi SMF manifest"
/usr/sbin/svccfg import ${INSTDIR}/smf/manifests/fwapi.xml

# echo "Enabling fwapi service"
# /usr/sbin/svcadm enable smartdc/site/fwapi

exit 0
