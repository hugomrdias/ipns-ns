'use strict';

const ky = require('ky-universal').default;

const ROOT = 'https://api.cloudflare.com/client/v4';
const ZONE_ID = 'a0ea791bb416addd330eda46badbe7eb';
const AUTH_HEADERS = {
    'X-Auth-Key': process.env.CF_KEY,
    'X-Auth-Email': process.env.CF_EMAIL
};

// function zones() {
//     return ky
//         .get(`${ROOT}/zones`, {
//             headers: AUTH_HEADERS,
//             searchParams: { name: 'ipns.dev' }
//         })
//         .json()
//         .then((data) => {
//             console.log(data);

//             return data;
//         })
//         .catch((err) => {
//             console.log(err);
//         });
// }

function records(filters = {}, zoneId = ZONE_ID) {
    return ky
        .get(`${ROOT}/zones/${zoneId}/dns_records`, {
            headers: AUTH_HEADERS,
            searchParams: filters
        })
        .json()
        .then(data => data.result)
        .catch(err => err.response
            .json()
            .then((data) => {
                const error = new Error(err.message);

                error.code = err.response.status;
                error.errors = data.errors;
                // console.log('TCL: data', data.errors[0].error_chain);

                throw error;
            })
        );
}

function addRecord(record, zoneId = ZONE_ID) {
    return ky
        .post(`${ROOT}/zones/${zoneId}/dns_records`, {
            headers: AUTH_HEADERS,
            json: record
        })
        .json()
        .then(data => data.result)
        .catch(err => err.response
            .json()
            .then((data) => {
                const error = new Error(err.message);

                error.code = err.response.status;
                error.errors = data.errors;
                // console.log('TCL: data', data.errors[0].error_chain);

                throw error;
            })
        );
}

function editRecord(record, id, zoneId = ZONE_ID) {
    console.log('edit');

    return ky
        .put(`${ROOT}/zones/${zoneId}/dns_records/${id}`, {
            headers: AUTH_HEADERS,
            json: record
        })
        .json()
        .then(data => data.result)
        .catch(err => err.response
            .json()
            .then((data) => {
                const error = new Error(err.message);

                error.code = err.response.status;
                error.errors = data.errors;
                // same settings errors
                if (data.errors[0].code === 81058) {
                    return;
                }
                // console.log('TCL: data', data.errors[0].error_chain);

                throw error;
            })
        );
}

module.exports = {
    records,
    addRecord,
    editRecord
};
