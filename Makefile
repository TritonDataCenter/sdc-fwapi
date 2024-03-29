#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2022 Joyent, Inc.
#

#
# FWAPI Makefile
#

NAME = fwapi

#
# Tools
#
ISTANBUL	:= node_modules/.bin/istanbul
FAUCET		:= node_modules/.bin/faucet
TAPE		:= ./node_modules/.bin/tape

ENGBLD_USE_BUILDIMAGE   = true
ENGBLD_REQUIRE          := $(shell git submodule update --init deps/eng)
include ./deps/eng/tools/mk/Makefile.defs
TOP ?= $(error Unable to access eng.git submodule Makefiles.)

#
# Files
#
BASH_FILES := bin/fwapi sbin/fwapid tools/restdown-header
DOC_FILES	 = index.md examples.md rules.md architecture.md
RESTDOWN_FLAGS   = --brand-dir=deps/restdown-brand-remora
EXTRA_DOC_DEPS	= deps/restdown-brand-remora/.git
JS_FILES	:= $(shell ls *.js) $(shell find lib test -name '*.js')
ESLINT_FILES   = $(JS_FILES)
ESLINT_FILES	= $(JS_FILES)
JSON_FILES	:= config.json.sample package.json
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o indent=2,doxygen,unparenthesized-return=0,strict-indent=true
SMF_MANIFESTS_IN = smf/manifests/fwapi.xml.in

BUILD_PLATFORM  = 20210826T002459Z

ifeq ($(shell uname -s),SunOS)
	# minimal-64-lts@21.4.0
	NODE_PREBUILT_IMAGE=a7199134-7e94-11ec-be67-db6f482136c2
	NODE_PREBUILT_VERSION=v6.17.1
	NODE_PREBUILT_TAG=zone64
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.defs
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.defs
else
	NODE := node
	NPM = $(shell which npm)
	NPM_EXEC := $(NPM)
endif
include ./deps/eng/tools/mk/Makefile.smf.defs


TOP             := $(shell pwd)
RELEASE_TARBALL := $(NAME)-pkg-$(STAMP).tar.gz
PKGDIR          := $(TOP)/$(BUILD)/pkg
INSTDIR         := $(PKGDIR)/root/opt/smartdc/fwapi
# triton-origin-x86_64-21.4.0
BASE_IMAGE_UUID = 502eeef2-8267-489f-b19c-a206906f57ef
BUILDIMAGE_NAME = $(NAME)
BUILDIMAGE_DESC	= SDC FWAPI
AGENTS		= amon config registrar

#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NPM_EXEC) $(REPO_DEPS) sdc-scripts
	$(NPM) install --production

$(TAPE): | $(NPM_EXEC)
	$(NPM) install

$(ISTANBUL): | $(NPM_EXEC)
	$(NPM) install

$(FAUCET): | $(NPM_EXEC)
	$(NPM) install

.PHONY: test
test: $(ISTANBUL) $(FAUCET)
	@$(NODE) $(ISTANBUL) cover --print none test/unit/run.js | $(FAUCET)

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
	cp node_modules/fwrule/docs/media/img/*.svg docs/media/img/

docs/examples.md: node_modules/fwrule/docs/examples.md
	$(TOP)/tools/restdown-header "Firewall API Examples" > docs/examples.md
	cat node_modules/fwrule/docs/examples.md >> docs/examples.md

CLEAN_FILES += ./node_modules \
	$(BUILD)/docs \
	docs/examples.md \
	docs/rules.md


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
	(cd $(PKGDIR) && $(TAR) -I pigz -cf $(TOP)/$(RELEASE_TARBALL) root site)

.PHONY: publish
publish: release
	mkdir -p $(ENGBLD_BITS_DIR)/fwapi
	cp $(TOP)/$(RELEASE_TARBALL) $(ENGBLD_BITS_DIR)/fwapi/$(RELEASE_TARBALL)

#
# Includes
#
include ./deps/eng/tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.targ
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.targ
else
	include ./deps/eng/tools/mk/Makefile.node.targ
endif
include ./deps/eng/tools/mk/Makefile.smf.targ
include ./deps/eng/tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
