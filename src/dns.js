'use strict';

const dns = require('dns-socket');
const mdns = require('multicast-dns');
const debug = require('debug')('ipns-server:dns');
const ipns = require('ipns');
const { getIps, chunkString, encodeTxt } = require('./utils');

const ips = getIps();
const DEFAULT_OPTIONS = {
    ttl: 120, // ttl needs to be > 0 or mdns assumes a goodbye
    domain: 'dns.ipns.dev',
    hostname: 'ipns.local',
    port: 5300,
    multicast: true,
    dnsOptions: {}, // https://github.com/mafintosh/dns-socket#var-socket--dnsoptions
    mdnsOptions: {} // https://github.com/mafintosh/multicast-dns#mdns--multicastdnsoptions
};

class DNSServer {
    /**
     * Create an instance
     * @param {Object} [options={}] - options
     * @param { import('keyv') } store - key/value store
     * @memberof DNSServer
     */
    constructor(options = {}, store) {
        this.options = Object.assign({}, DEFAULT_OPTIONS, options);
        this.dns = null;
        this.mdns = null;
        this.store = store;
    }

    listen() {
        if (this.options.multicast) {
            this.listenMdns();
        }
        this.listenDNS();

        return this;
    }

    destroy(onclose) {
        if (this.mdns) {
            this.mdns.destroy(() => {
                this.dns.destroy(onclose);
            });
        } else {
            this.dns.destroy(onclose);
        }
    }

    listenMdns() {
        this.mdns = mdns(this.options.mdnsOptions);

        this.mdns.on('query', (query, { port, host }) => {
            const answers = [];

            query.questions.forEach(q => this.handleQuestionMdns(q, port, host, answers));

            if (answers.length > 0) {
                return this.mdns.respond(
                    { answers },
                    () => debug('response sent for ', answers, query)
                );
            }

            return answers;
        });
    }

    listenDNS() {
        this.dns = dns(this.options.dns);
        this.dns.bind(this.options.port, () => {
            console.log(`> Running DNS on localhost:${this.options.port}`);
        });
        this.dns.on('query', (query, port, host) => {
            debug(
                'DNS query %s:%s %dQ %dA +%d',
                host, port,
                query.questions.length,
                query.answers.length,
                query.additionals.length
            );

            const reply = {
                flags: dns.AUTHORITATIVE_ANSWER,
                questions: query.questions,
                answers: []
            };

            const all = query.questions.map(q => this.handleQuestion(q, port, host, reply.answers));

            Promise.all(all)
                .then(() => {
                    if (reply.answers.length > 0) {
                        return this.dns.response(query, reply, port, host);
                    }

                    return reply;
                })
                .catch(err => debug(err));
        });

        this.dns.on('error', (err) => {
            debug('Error', err);
        });
    }

    async handleQuestion(query, port, host, answers) {
        const name = query.name.toLowerCase();

        // skip for random domain
        if (!name.endsWith(this.options.domain)) {
            debug('Skip not my domain ' + name);

            return;
        }
        console.log(name, query.type, this.options.domain);

        const parts1 = name.replace('.' + this.options.domain, '').split('.');

        if (query.type === 'SOA') {
            answers.push({
                type: 'SOA',
                name: name,
                ttl: 3600,
                data: {
                    mname: 'foo.ns.ipns.dev',
                    rname: 'dns.ipns.dev',
                    serial: 2017031405,
                    refresh: 3600,
                    retry: 2400,
                    expire: 604800,
                    minimum: 3600
                }
            });
        }

        if (query.type === 'A' && name === this.options.domain) {
            answers.push({
                type: 'A',
                name: name,
                ttl: this.options.ttl,
                data: ips.ipv4[1]
            });
        }

        if (query.type === 'NS') {
            answers.push({
                type: 'NS',
                name: name,
                ttl: 3600,
                data: 'foo.ns.ipns.dev'
            });
            answers.push({
                type: 'NS',
                name: name,
                ttl: 3600,
                data: 'bar.ns.ipns.dev'
            });
        }

        if (query.type === 'TXT' && parts1.length === 1) {
            const key = parts1[0];

            const recordEncoded = await this.store.get(key);

            console.log('RECORD', key, recordEncoded);

            if (recordEncoded) {
                // const entry = ipns.unmarshal(Buffer.from(recordEncoded, 'base64'));

                debug('Replying ipns record via TXT to', host + ':' + port);
                answers.push({
                    type: 'TXT',
                    name: name,
                    ttl: this.options.ttl,
                    data: chunkString(recordEncoded, 255)
                });
                // answers.push({
                //     type: 'TXT',
                //     name: name,
                //     ttl: this.options.ttl,
                //     data: encodeTxt({ dnslink: entry.value.toString() })
                // });
            }
        }

        if (query.type === 'A' && parts1.length === 1) {
            answers.push({
                type: 'CNAME',
                name: name,
                ttl: this.options.ttl,
                data: 'cloudflare-ipfs.com'
            });
        }

        if (query.type === 'TXT' && parts1.length === 2 && parts1[0] === '_dnslink') {
            const key = parts1[1];

            const recordEncoded = await this.store.get(key);

            console.log('RECORD _dnslink', key, recordEncoded);

            if (recordEncoded) {
                const entry = ipns.unmarshal(Buffer.from(recordEncoded, 'base64'));

                debug('Replying ipns record via TXT to', host + ':' + port);
                answers.push({
                    type: 'TXT',
                    name: name,
                    ttl: this.options.ttl,
                    data: encodeTxt({ dnslink: entry.value.toString() })
                });
            }
        }
    }

    handleQuestionMdns(q, port, host, answers) {
        if (q.name === this.options.hostname && (q.type === 'A' || q.type === 'ANY')) {
            for (const ip of ips.ipv4) {
                answers.push({
                    name: this.options.hostname,
                    type: 'A',
                    ttl: this.options.ttl,
                    flush: true,
                    data: ip
                });
            }
        }

        if (q.name === this.options.hostname && (q.type === 'AAAA' || q.type === 'ANY')) {
            for (const ip of ips.ipv6) {
                answers.push({
                    name: this.options.hostname,
                    type: 'AAAA',
                    ttl: this.options.ttl,
                    flush: true,
                    data: ip
                });
            }
        }
    }
}

module.exports = DNSServer;

