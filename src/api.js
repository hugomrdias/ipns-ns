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

const extract = promisify(ipns.extractPublicKey);
const validate = promisify(ipns.validate);

/**
 * Start api
 *
 * @param {Object} [options={}]
 * @param {typeof import('keyv')} keyv
 */
module.exports = function(options = { port: 3000 }, keyv) {
    polka()
        .use(json())
        .use(raw({ type: 'application/dns-udpwireformat' }))
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
        .put('/', async (req, res) => {
            try {
                const { key, record } = req.body;

                await validateKey(key, record);
                await keyv.set(key, record);
                await createLink(key, record);
                console.log('SAVE KEY', key, record);
                send(res, 201);
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

async function createLink(key, record) {
    const entry = ipns.unmarshal(Buffer.from(record, 'base64'));
    const cf = new Cloudflare({
        email: process.env.CF_EMAIL,
        key: process.env.CF_KEY
    });

    const { result } = await cf.zones.browse();

    const zone = result.find(z => z.name === 'ipns.dev');
    const { result: records } = await cf.dnsRecords.browse(zone.id);
    const match = records.filter(r => r.name.includes(key));

    if (!match.find(r => r.name === `${key}.ipns.dev`)) {
        await cf.dnsRecords.add(zone.id, {
            type: 'CNAME',
            name: key,
            content: 'cloudflare-ipfs.com'
        });
    }

    const link = match.find(r => r.name === `_dnslink.${key}.ipns.dev`);

    if (link) {
        await cf.dnsRecords.edit(
            zone.id,
            link.id,
            {
                type: 'TXT',
                name: '_dnslink.' + key,
                content: 'dnslink=' + entry.value.toString()
            });
    } else {
        await cf.dnsRecords.add(zone.id, {
            type: 'TXT',
            name: '_dnslink.' + key,
            content: 'dnslink=' + entry.value.toString()
        });
    }
}

