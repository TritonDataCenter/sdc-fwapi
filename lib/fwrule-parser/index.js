// Copyright 2011 Joyent, Inc.  All rights reserved.

var fw = require("./fwrule-parser").parser;

exports.parse = function parse () { return fw.parse.apply(fw, arguments) };

var uuidRE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var portRE = /^[0-9]{1,5}$/;

fw.yy.tagOrPortOrUUID = function (lexer) {
  if (uuidRE.exec(lexer.yytext)) {
    return 'UUID';
  }

  if (portRE.exec(lexer.yytext)) {
    if (Number(lexer.yytext) > 65536) {
      throw new Error("Invalid port number '" + lexer.yytext + "'");
    }
    return 'PORTNUM';
  }
  return 'TAGTXT';
}

