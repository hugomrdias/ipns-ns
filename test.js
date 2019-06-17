'use strict';

const mdns = require('multicast-dns')();

mdns.on('response', (query) => {
    if (query.answers[0] && query.answers[0].name === 'ipns.local') {
        console.log('TCL: query.answers[0]', query.answers[0]);
    }
});

mdns.query({
    questions: [{
        name: 'ipns.local',
        type: 'A'
    }]
});
