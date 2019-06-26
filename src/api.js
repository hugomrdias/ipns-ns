'use strict';

const { promisify } = require('util');
const polka = require('polka');
const send = require('@polka/send-type');
const { json, raw } = require('body-parser');
const morgan = require('morgan');
const cors = require('cors');
const Cloudflare = require('cloudflare');
const ipns = require('ipns');
const peerid = require('peer-id');
const dnsPacket = require('dns-packet');
const Cid = require('cids');
const { chunkString, getRandomInt } = require('./utils');

const extract = promisify(ipns.extractPublicKey);
const validate = promisify(ipns.validate);
const cf = new Cloudflare({
    email: process.env.CF_EMAIL,
    key: process.env.CF_KEY
});

/**
 * Start api
 *
 * @param {Object} [options={}]
 * @param {typeof import('keyv')} keyv
 */
module.exports = function(options = { port: 3000 }, keyv) {
    polka()
        .use(cors())
        .use(morgan('combined'))
        .options('*', cors())
        .get('/', async (req, res) => {
            const record = await keyv.get(req.query.key);

            if (record) {
                return send(res, 200, {
                    key: req.query.key,
                    record
                });
            }

            send(res, 404);
        })
        .get('/dns-query', async (req, res) => {
            const { questions } = dnsPacket.decode(Buffer.from(req.query.dns, 'base64'));

            if (questions.length > 0) {
                const [key] = questions[0].name.split('.');
                const record = await keyv.get(key);

                if (record) {
                    const buf = dnsPacket.encode({
                        type: 'response',
                        answers: [{
                            type: 'TXT',
                            name: `${key}.ipns.local`,
                            data: chunkString(record, 255)
                        }]
                    });

                    return send(res, 200, buf, { 'Content-Type': 'application/dns-message' });
                }
            }

            send(res, 404);
        })
        .put('/', json(), async (req, res) => {
            try {
                const { key, record, subdomain, alias } = req.body;

                await validateKey(key, record);
                await keyv.set(key, record);
                console.log('SAVE KEY', key);
                send(res, 201, {
                    subdomain: subdomain ? await createLink(key, record) : '',
                    alias: alias ? await createAlias(alias, record) : ''
                });
            } catch (err) {
                console.log('TCL: err', err);
                send(res, 400, { error: err.message });
            }
        })
        .listen(options.port, (err) => {
            if (err) {
                throw err;
            }
            console.log(`> Running HTTP on localhost:${options.port}`);
        });
};

function validateKey(key, record) {
    const entry = ipns.unmarshal(Buffer.from(record, 'base64'));
    const cid = new Cid(key);
    const p = peerid.createFromBytes(cid.multihash);

    return extract(p, entry)
        .then(pubkey => validate(pubkey, entry));
}

async function createAlias(alias, key, record) {
    const entry = ipns.unmarshal(Buffer.from(record, 'base64'));
    const { result: zones } = await cf.zones.browse();
    const zone = zones.find(z => z.name === 'ipns.dev');
    const { result: records } = await cf.dnsRecords.browse(zone.id);

    // find control record
    const match = records.find((r) => {
        if (r.type === 'TXT' && r.name === 'alias') {
            return true;
        }

        return false;
    });

    if (!match) {
        await cf.dnsRecords.add(zone.id, {
            type: 'CNAME',
            name: alias,
            content: 'cloudflare-ipfs.com'
        });
        await cf.dnsRecords.add(zone.id, {
            type: 'TXT',
            name: alias,
            content: key
        });
        await cf.dnsRecords.add(zone.id, {
            type: 'TXT',
            name: '_dnslink.' + alias,
            content: 'dnslink=' + entry.value.toString()
        });

        return `https://${alias}.ipns.dev`;
    }

    if (match.content === key) {
        await cf.dnsRecords.edit(
            zone.id,
            match.id,
            {
                type: 'TXT',
                name: '_dnslink.' + alias,
                content: 'dnslink=' + entry.value.toString()
            });

        return `https://${alias}.ipns.dev`;
    }

    alias += getRandomInt(999);
    await cf.dnsRecords.add(zone.id, {
        type: 'CNAME',
        name: alias,
        content: 'cloudflare-ipfs.com'
    });
    await cf.dnsRecords.add(zone.id, {
        type: 'TXT',
        name: alias,
        content: key
    });
    await cf.dnsRecords.add(zone.id, {
        type: 'TXT',
        name: '_dnslink.' + alias,
        content: 'dnslink=' + entry.value.toString()
    });

    return `https://${alias}.ipns.dev`;
}

async function createLink(key, record) {
    const entry = ipns.unmarshal(Buffer.from(record, 'base64'));
    const { result: zones } = await cf.zones.browse();
    const zone = zones.find(z => z.name === 'ipns.dev');
    const { result: records } = await cf.dnsRecords.browse(zone.id);

    const match = records.filter(r => r.name.includes(key));

    console.log('TCL: createLink -> match', match);

    if (!match.find(r => r.name === `${key}.ipns.dev`)) {
        await cf.dnsRecords.add(zone.id, {
            type: 'CNAME',
            name: key,
            content: 'cloudflare-ipfs.com'
        });
    }

    const link = match.find(r => r.name === `_dnslink.${key}.ipns.dev`);

    console.log('dnslink', link);
    if (link) {
        console.log('edit');
        await cf.dnsRecords.edit(
            zone.id,
            link.id,
            {
                type: 'TXT',
                name: '_dnslink.' + key,
                content: 'dnslink=' + entry.value.toString()
            });
    } else {
        console.log('add');
        await cf.dnsRecords.add(zone.id, {
            type: 'TXT',
            name: '_dnslink.' + key,
            content: 'dnslink=' + entry.value.toString()
        });
    }

    return `https://${key}.ipns.dev`;
}
