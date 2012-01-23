// Copyright 2012 Joyent, Inc.  All rights reserved.

var util = require('util');
var fw = require("./parser").parser;
var validators = require("./validators");
// XXX: don't use restify errors when on commandline
var restify = require('restify');



//--- Globals

var uuidRE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var portRE = /^[0-9]{1,5}$/;



//--- Validation functions

fw.yy.tagOrPortOrUUID = function tagOrPortOrUUID(lexer) {
  if (uuidRE.exec(lexer.yytext)) {
    return 'UUID';
  }

  if (portRE.exec(lexer.yytext)) {
    if (Number(lexer.yytext) > 65536) {
      throw new ParserError("Invalid port number '" + lexer.yytext + "'");
    }
    return 'PORTNUM';
  }
  return 'TAGTXT';
}


fw.yy.validateIPv4address = function validateIPv4address(ip) {
  if (!validators.validateIPv4address(ip)) {
    throw new restify.InvalidArgumentError("IP address '" + ip + "' is invalid");
  }
}


fw.yy.validateIPv4subnet = function validateIPv4subnet(subnet) {
  if (!validators.validateIPv4subnet(subnet)) {
    throw new restify.InvalidArgumentError("Subnet '" + subnet
        + "' is invalid (must be in CIDR format)");
  }
}



//--- Error handling


fw.yy.parseError = function parseError(str, hash) {
  //throw new ParserError(str);
  throw new restify.InvalidArgumentError(409, str);
}


function ParserError(message, extra, caller) {
  console.log("new ParserError!");
}

util.inherits(ParserError, Error);



module.exports = {
  parse: function parse () { return fw.parse.apply(fw, arguments) },
  ParserError: ParserError
};

