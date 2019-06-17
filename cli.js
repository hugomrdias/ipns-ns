#!/usr/bin/env node

'use strict';

const meow = require('meow');
const ipnsDns = require('./src');

const cli = meow(`
    Usage
        $ ipns-dns <options>
    Options
        --api-port  Port to bind for the API [Default: 8000]
        --dns-port  Port to bind for the DNS Server [Default: 5300]
        --dns-domain  DNS Domain [Default: ipns.dev]
        --dns-hostname  Hostname to annouce using mdns [Default: ipns.local]
        --dns-ttl  Time to live [Default: 120]
        --dns-multicast  Enable multicast dns [Default: true]
    Examples
        $ ipns-dns --api-port 80 --dns-port 53 --dns-multicast false
        ## global mode
        $ ipns-dns
        ## local mode
`, {
    flags: {
        'api-port': {
            type: 'string',
            default: '8000'
        },
        'dns-port': {
            type: 'string',
            default: '5300'
        },
        'dns-domain': {
            type: 'string',
            default: 'dns.ipns.dev'
        },
        'dns-hostname': {
            type: 'string',
            default: 'ipns.local'
        },
        'dns-ttl': {
            type: 'string',
            default: '120'
        },
        'dns-multicast': {
            type: 'boolean',
            default: true
        }
    }
});

ipnsDns({
    api: { port: Number(cli.flags.apiPort) },
    dns: {
        port: Number(cli.flags.dnsPort),
        domain: cli.flags.dnsDomain,
        hostname: cli.flags.dnsHostname,
        ttl: Number(cli.flags.dnsTtl),
        multicast: cli.flags.dnsMulticast
    }
});
