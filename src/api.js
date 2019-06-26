'use strict';

const { promisify } = require('util');
const polka = require('polka');
const send = require('@polka/send-type');
const { json, raw } = require('body-parser');
const morgan = require('morgan');
const cors = require('cors');
// const Cloudflare = require('cloudflare');
const ipns = require('ipns');
const peerid = require('peer-id');
const dnsPacket = require('dns-packet');
const Cid = require('cids');
const { chunkString, getRandomInt } = require('./utils');
const cf = require('./cf-client');

const extract = promisify(ipns.extractPublicKey);
const validate = promisify(ipns.validate);
// const cf = new Cloudflare({
//     email: process.env.CF_EMAIL,
//     key: process.env.CF_KEY
// });

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

                const entry = ipns.unmarshal(Buffer.from(record, 'base64'));

                await validateKey(key, entry);
                await keyv.set(key, record);
                console.log('SAVE KEY', key);
                send(res, 201, {
                    subdomain: subdomain ? await createSubdomain(key, entry) : '',
                    alias: alias ? await createAlias(alias, key, entry) : ''
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

function validateKey(key, entry) {
    const cid = new Cid(key);
    const p = peerid.createFromBytes(cid.multihash);

    return extract(p, entry)
        .then(pubkey => validate(pubkey, entry));
}

async function createAlias(alias, key, entry) {
    const match = await cf.records({
        type: 'TXT',
        name: `${alias}.ipns.dev`
    });

    if (match.length === 0) {
        await cf.addRecord({
            type: 'CNAME',
            name: alias,
            content: 'cloudflare-ipfs.com'
        });
        await cf.addRecord({
            type: 'TXT',
            name: alias + '-id',
            content: key
        });
        await cf.addRecord({
            type: 'TXT',
            name: alias,
            content: 'dnslink=' + entry.value.toString()
        });

        return `https://${alias}.ipns.dev`;
    }

    // check if request is valid for this key
    const [idRecord] = await cf.records({
        type: 'TXT',
        name: `${alias}-id.ipns.dev`,
        content: key
    });

    if (idRecord) {
        const [dnslinkRecord] = await cf.records({
            type: 'TXT',
            name: `${alias}.ipns.dev`
        });

        await cf.editRecord(
            {
                type: 'TXT',
                name: alias,
                content: 'dnslink=' + entry.value.toString()
            },
            dnslinkRecord.id
        );

        return `https://${alias}.ipns.dev`;
    }

    alias += getRandomInt(999);
    await cf.addRecord({
        type: 'CNAME',
        name: alias,
        content: 'cloudflare-ipfs.com'
    });
    await cf.addRecord({
        type: 'TXT',
        name: alias + '-id',
        content: key
    });
    await cf.addRecord({
        type: 'TXT',
        name: alias,
        content: 'dnslink=' + entry.value.toString()
    });

    return `https://${alias}.ipns.dev`;
}

async function createSubdomain(key, entry) {
    const { dnslinkRecord } = await cf.records({
        type: 'TXT',
        name: `${key}.ipns.dev`
    });

    if (dnslinkRecord) {
        await cf.editRecord(
            {
                type: 'TXT',
                name: key,
                content: 'dnslink=' + entry.value.toString()
            },
            dnslinkRecord.id
        );

        return `https://${key}.ipns.dev`;
    }

    await cf.addRecord({
        type: 'CNAME',
        name: key,
        content: 'cloudflare-ipfs.com'
    });
    await cf.addRecord({
        type: 'TXT',
        name: key,
        content: 'dnslink=' + entry.value.toString()
    });

    return `https://${key}.ipns.dev`;
}
