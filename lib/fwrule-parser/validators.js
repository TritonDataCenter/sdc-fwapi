// Copyright 2012 Joyent, Inc.  All rights reserved.

var net = require('net');

function validateIPv4address(ip) {
  if (!net.isIPv4(ip) || (ip == "255.255.255.255") || (ip == "0.0.0.0")) {
    return false;
  }
  return true;
}

// Ensure subnet is in valid CIDR form
function validateIPv4subnet(subnet) {
  var parts = subnet.split('/');
  if (!validateIPv4address(parts[0])) {
    return false;
  }
  if (!parseInt(parts[1]) || (parts[1] < 1) || (parts[1] > 32)) {
    return false;
  }
  return true;
}

module.exports = {
  validateIPv4address: validateIPv4address,
  validateIPv4subnet: validateIPv4subnet
};
