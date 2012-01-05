.PHONY: test

parser:
	./node_modules/.bin/jison  -o lib/fwrule-parser/parser.js ./src/fwrule-parser.jison

test:
	./node_modules/.bin/tap ./test/*.js
