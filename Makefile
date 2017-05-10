#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2017, Joyent, Inc.
#

#
# FWAPI Makefile
#


#
# Tools
#
ISTANBUL	:= node_modules/.bin/istanbul
FAUCET		:= node_modules/.bin/faucet
TAPE		:= ./node_modules/.bin/tape


#
# Files
#
BASH_FILES := bin/fwapi sbin/fwapid tools/restdown-header
DOC_FILES	 = index.md examples.md rules.md architecture.md
RESTDOWN_FLAGS   = --brand-dir=deps/restdown-brand-remora
EXTRA_DOC_DEPS	= deps/restdown-brand-remora/.git
JS_FILES	:= $(shell ls *.js) $(shell find lib test -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
ESLINT		= ./node_modules/.bin/eslint
ESLINT_CONF	= tools/eslint.node.conf
ESLINT_FILES	= $(JS_FILES)
JSON_FILES	:= config.json.sample package.json
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o indent=4,doxygen,unparenthesized-return=0
SMF_MANIFESTS_IN = smf/manifests/fwapi.xml.in


include ./tools/mk/Makefile.defs
ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_VERSION=v0.10.26
	NODE_PREBUILT_TAG=zone
	# This is sdc-minimal-multiarch-lts@15.4.1, compat with
	# triton-origin-multiarch-15.4.1.
	NODE_PREBUILT_IMAGE=18b094b0-eb01-11e5-80c1-175dac7ddf02
	include ./tools/mk/Makefile.node_prebuilt.defs
else
	NPM_EXEC :=
	NPM = npm
endif
include ./tools/mk/Makefile.smf.defs


TOP             := $(shell pwd)
RELEASE_TARBALL := fwapi-pkg-$(STAMP).tar.bz2
PKGDIR          := $(TOP)/$(BUILD)/pkg
INSTDIR         := $(PKGDIR)/root/opt/smartdc/fwapi


#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NPM_EXEC) $(REPO_DEPS) sdc-scripts
	$(NPM) install --production

$(ESLINT): | $(NPM_EXEC)
	$(NPM) install \
	    eslint@`json -f package.json devDependencies.eslint` \
	    eslint-plugin-joyent@`json -f package.json devDependencies.eslint-plugin-joyent`

$(TAPE): | $(NPM_EXEC)
	$(NPM) install

$(ISTANBUL): | $(NPM_EXEC)
	$(NPM) install

$(FAUCET): | $(NPM_EXEC)
	$(NPM) install

.PHONY: test
test: $(ISTANBUL) $(FAUCET)
	@$(ISTANBUL) cover --print none test/unit/run.js | $(FAUCET)

.PHONY: teststop
teststop:
	@(for F in test/unit/*.test.js; do \
		echo "# $$F" ;\
		$(TAPE) $$F ;\
		[[ $$? == "0" ]] || exit 1; \
	done)

node_modules/fwrule: | $(NPM_EXEC)
	$(NPM) install fwrule

node_modules/fwrule/docs/rules.md: node_modules/fwrule
node_modules/fwrule/docs/examples.md: node_modules/fwrule

docs/rules.md: node_modules/fwrule/docs/rules.md
	$(TOP)/tools/restdown-header "Firewall API Rule Syntax" > docs/rules.md
	cat node_modules/fwrule/docs/rules.md >> docs/rules.md

docs/examples.md: node_modules/fwrule/docs/examples.md
	$(TOP)/tools/restdown-header "Firewall API Examples" > docs/examples.md
	cat node_modules/fwrule/docs/examples.md >> docs/examples.md

CLEAN_FILES += ./node_modules $(BUILD)/docs docs/examples.md docs/rules.md


#
# Packaging targets
#
.PHONY: release
release: $(RELEASE_TARBALL)

.PHONY: pkg
pkg: all $(SMF_MANIFESTS)
	@echo "Building $(RELEASE_TARBALL)"
	@rm -rf $(PKGDIR)
	@mkdir -p $(PKGDIR)/site
	@mkdir -p $(INSTDIR)/smf/manifests
	@mkdir $(INSTDIR)/test
	@touch $(PKGDIR)/site/.do-not-delete-me
	cp -r $(TOP)/server.js \
		$(TOP)/bin \
		$(TOP)/lib \
		$(TOP)/node_modules \
		$(TOP)/package.json \
		$(TOP)/sapi_manifests \
		$(TOP)/sbin \
		$(INSTDIR)/
	cp -r $(TOP)/test/bin \
		$(TOP)/test/config.json.in \
		$(TOP)/test/integration \
		$(TOP)/test/lib \
		$(TOP)/test/runtest \
		$(TOP)/test/runtests \
		$(INSTDIR)/test/
	cp smf/manifests/*.xml $(INSTDIR)/smf/manifests
	cp -PR $(NODE_INSTALL) $(INSTDIR)/node
	mkdir -p $(PKGDIR)/root/opt/smartdc/boot
	cp -R $(TOP)/deps/sdc-scripts/* $(PKGDIR)/root/opt/smartdc/boot/
	cp -R $(TOP)/boot/* $(PKGDIR)/root/opt/smartdc/boot/
	# Clean up some dev / build bits
	find $(INSTDIR) -name "*.pyc" | xargs rm -f
	find $(INSTDIR) -name "*.o" | xargs rm -f
	find $(INSTDIR) -name c4che | xargs rm -rf   # waf build file
	find $(INSTDIR) -name .wafpickle* | xargs rm -rf   # waf build file
	find $(INSTDIR) -name .lock-wscript | xargs rm -rf   # waf build file
	find $(INSTDIR) -name config.log | xargs rm -rf   # waf build file
	rm -rf $(INSTDIR)/node_modules/jison	# we don't need to regenerate the parser

$(RELEASE_TARBALL): pkg
	(cd $(PKGDIR) && $(TAR) -jcf $(TOP)/$(RELEASE_TARBALL) root site)

.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
    echo "error: 'BITS_DIR' must be set for 'publish' target"; \
    exit 1; \
  fi
	mkdir -p $(BITS_DIR)/fwapi
	cp $(TOP)/$(RELEASE_TARBALL) $(BITS_DIR)/fwapi/$(RELEASE_TARBALL)


.PHONY: check
check:: $(ESLINT)
	$(ESLINT) -c $(ESLINT_CONF) $(ESLINT_FILES)


#
# Includes
#
include ./tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.targ
else
	include ./tools/mk/Makefile.node.targ
endif
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
