'use strict';

require('dotenv').config();
const Keyv = require('keyv');
const DNSServer = require('./dns');
const api = require('./api');

const keyv = new Keyv();

module.exports = function(options = {}) {
    const server = new DNSServer(options.dns, keyv);

    server.listen();
    api(options.api, keyv);
};
