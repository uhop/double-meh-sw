// Page-side registration + the message contract in action.
navigator.serviceWorker.register('/sw.js', {type: 'module'});

const post = message => navigator.serviceWorker.ready.then(r => r.active.postMessage(message));

post({type: 'io:hello', library: 'double-meh'}); // announce the library: the SW yields bundling
post({type: 'io:invalidate', pattern: '/api/users/'}); // evict the shared tier across all tabs
