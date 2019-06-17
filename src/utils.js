'use strict';

const { networkInterfaces } = require('os');

function getIps() {
    const interfaces = networkInterfaces();
    const ips = {
        ipv4: ['127.0.0.1'],
        ipv6: ['::1']
    };

    // eslint-disable-next-line guard-for-in
    for (const key in interfaces) {
        interfaces[key].forEach((addr) => {
            if (addr.family === 'IPv4' && !addr.internal) {
                ips.ipv4.push(addr.address);
            }
            if (addr.family === 'IPv6' && !addr.internal) {
                ips.ipv6.push(addr.address);
            }
        });
    }

    return ips;
}

function encodeTxt(data) {
    const keys = Object.keys(data);
    const bufs = [];

    for (let i = 0; i < keys.length; i++) {
        bufs.push(Buffer.from(keys[i] + '=' + data[keys[i]]));
    }

    return bufs;
}

function chunkString(str, length) {
    return str.match(new RegExp('.{1,' + length + '}', 'g'));
}

module.exports = {
    getIps,
    encodeTxt,
    chunkString
};
