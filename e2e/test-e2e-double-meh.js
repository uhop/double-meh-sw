// Cross-package conformance: the page half is the PUBLISHED double-meh, not a hand-rolled stand-in.
// What this pins is the v1 contract itself — if either side drifts, these assertions are what break.
import test from 'tape-six';

import {withPage} from './harness.js';

const install = async page =>
  page.evaluate(async () => {
    const {default: io} = await import('/node_modules/double-meh/src/index.js');
    const {installSW, installChannel} = await import('/node_modules/double-meh/src/sw.js');
    installSW(io);
    installChannel(io);
    window.io = io;
    return io.sw.hello();
  });

test('e2e: the published double-meh speaks the v1 contract to this SW', async t => {
  await withPage(async ({page, counters}) => {
    const hello = await install(page);
    t.ok(hello.connected, 'installSW completed the io:hello handshake');
    t.equal(hello.contract, 1, 'both halves agree on contract v1');
    t.equal(hello.version, 'e2e-1', "the SW's configured version reached the page");
    t.ok(
      hello.capabilities.includes('transport'),
      'the transport capability is visible to the page'
    );
    t.ok(hello.capabilities.includes('stream'), 'and so is the stream capability');

    // the sw transport: page -> io:fetch -> SW -> upstream -> io:result -> a real Response
    const viaSW = await page.evaluate(() =>
      window.io.get('/api/via-sw', undefined, {transport: 'sw'})
    );
    t.equal(viaSW.route, '/api/via-sw', 'the published client decoded the io:result body');
    t.equal(counters.apiDirect['via-sw'], 1, 'exactly one upstream hop, made by the SW');

    // client-wins: the announced library keeps ownership, so its burst is never SW-bundled
    const burst = await page.evaluate(() =>
      Promise.all([window.io.get('/api/p'), window.io.get('/api/q')])
    );
    t.deepEqual(
      burst.map(part => part.hop),
      ['direct', 'direct'],
      'a double-meh page owns its own bundling'
    );
    t.equal(counters.bundlePuts, 0, 'the SW never opened a bundle window for it');

    // the channel half: an eviction on the page fans out through the SW as io:invalidated
    const invalidated = await page.evaluate(async () => {
      const seen = new Promise(done => {
        const channel = new BroadcastChannel('io');
        channel.onmessage = event => done(event.data);
      });
      await window.io.cache.remove(location.origin + '/api/');
      return seen;
    });
    t.equal(invalidated.type, 'io:invalidated', 'the page eviction reached the other tabs');
  });
});
