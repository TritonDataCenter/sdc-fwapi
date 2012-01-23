.PHONY: test

parser:
	./node_modules/.bin/jison  -o lib/fwrule-parser/parser.js ./src/fwrule-parser.jison

test:
	./node_modules/.bin/tap ./test/*.js

joyentdeps:
	cd node_modules; \
	rm -rf node-sdc-clients; \
	git clone git@git.joyent.com:node-sdc-clients.git; \
	/bin/echo -n "node-sdc-clients: " > joyent-versions; \
	cd node-sdc-clients; \
	git describe >> ../joyent-versions; \
	rm -rf .git; \
	npm install
