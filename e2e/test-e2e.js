import test from 'tape-six';

import {withPage, snapshot} from './harness.js';

test('e2e: the whole triad over real wires — bundle, tier, messages, transport, client-wins', async t => {
  await withPage(async ({page, counters, controlled}) => {
    t.ok(controlled, 'the real module SW registered and took control');

    // A: a burst from a library-less page is SW-bundled through the real bundler
    const burst = await page.evaluate(() =>
      Promise.all([
        fetch('/api/a').then(response => response.json()),
        fetch('/api/b').then(response => response.json())
      ])
    );
    t.deepEqual(
      burst.map(part => part.hop),
      ['internal', 'internal'],
      'both parts came back through the bundler and its second hop'
    );
    const afterBurst = snapshot(counters);
    t.equal(afterBurst.bundlePuts, 1, 'one bundle PUT carried the whole burst');
    t.deepEqual(afterBurst.internal, {a: 1, b: 1}, 'each part resolved upstream exactly once');
    t.deepEqual(afterBurst.apiDirect, {}, 'nothing leaked to a direct hop');

    // B: the shared tier serves the repeat with no wire hit at all
    const repeat = await page.evaluate(() => fetch('/api/a').then(response => response.json()));
    t.equal(repeat.hop, 'internal', 'the repeat is the bundled body');
    t.deepEqual(snapshot(counters), afterBurst, 'and it cost nothing on any wire');

    // C: hello / invalidate over real postMessage, with the BroadcastChannel fan-out
    const messages = await page.evaluate(async () => {
      const post = message => navigator.serviceWorker.controller.postMessage(message);
      const once = () =>
        new Promise(done =>
          navigator.serviceWorker.addEventListener('message', event => done(event.data), {
            once: true
          })
        );
      const helloReply = once();
      post({type: 'io:hello'});
      const hello = await helloReply;
      const broadcast = new Promise(done => {
        const channel = new BroadcastChannel('io');
        channel.onmessage = event => done(event.data);
      });
      const invalidateReply = once();
      post({type: 'io:invalidate', pattern: location.origin + '/api/'});
      return {hello, invalidated: await invalidateReply, broadcasted: await broadcast};
    });
    t.equal(messages.hello.v, 1, 'hello carries contract v1');
    t.equal(messages.hello.version, 'e2e-1', 'and the configured version');
    t.ok(messages.hello.capabilities.includes('transport'), 'capabilities are announced');
    t.ok(
      messages.hello.capabilities.includes('stream'),
      'Chromium transfers streams, so the stream capability is advertised'
    );
    t.equal(messages.invalidated.evicted, 2, 'both tier entries evicted');
    t.equal(messages.broadcasted.type, 'io:invalidated', 'the eviction fanned out to other tabs');

    // D: after eviction a lone request is below the bundle window and degrades to a direct fetch
    const lone = await page.evaluate(() => fetch('/api/a').then(response => response.json()));
    t.equal(lone.hop, 'direct', 'a lone request goes straight to the network');
    t.deepEqual(snapshot(counters).apiDirect, {a: 1}, 'exactly one direct hop');

    // E: the io:fetch transport over a real MessageChannel, body transferred
    const transported = await page.evaluate(async () => {
      const channel = new MessageChannel();
      const reply = new Promise(done => (channel.port1.onmessage = event => done(event.data)));
      navigator.serviceWorker.controller.postMessage(
        {type: 'io:fetch', id: 't1', url: location.origin + '/api/prefetched'},
        [channel.port2]
      );
      const result = await reply;
      return {
        id: result.id,
        status: result.status,
        streamed: !!result.stream,
        body: JSON.parse(new TextDecoder().decode(result.body))
      };
    });
    t.equal(transported.id, 't1', 'the result is correlated by id');
    t.equal(transported.status, 200, 'with the upstream status');
    t.notOk(transported.streamed, 'a request that did not ask for a stream gets the v1 buffer');
    t.equal(transported.body.route, '/api/prefetched', 'and the real body');
    const served = await page.evaluate(() =>
      fetch('/api/prefetched').then(response => response.json())
    );
    t.equal(
      served.route,
      '/api/prefetched',
      'the transport seeded the tier — a later fetch is free'
    );
    t.deepEqual(
      snapshot(counters).apiDirect,
      {a: 1, prefetched: 1},
      'the prefetch cost exactly one hop, and the page fetch cost none'
    );

    // F: client-wins — a page that announces a library is never SW-bundled again
    const clientWins = await page.evaluate(async () => {
      navigator.serviceWorker.controller.postMessage({type: 'io:hello', library: 'double-meh'});
      await new Promise(done => setTimeout(done, 50));
      return Promise.all([
        fetch('/api/x').then(response => response.json()),
        fetch('/api/y').then(response => response.json())
      ]);
    });
    t.deepEqual(
      clientWins.map(part => part.hop),
      ['direct', 'direct'],
      'the library owns its bundling; the SW only passes the traffic through'
    );
    t.equal(snapshot(counters).bundlePuts, 1, 'still the one bundle PUT from the very first burst');
  });
});

test('e2e: a client that asks for a stream gets a transferred ReadableStream', async t => {
  await withPage(async ({page}) => {
    const result = await page.evaluate(async () => {
      const channel = new MessageChannel();
      const reply = new Promise(done => (channel.port1.onmessage = event => done(event.data)));
      navigator.serviceWorker.controller.postMessage(
        {type: 'io:fetch', id: 's1', url: location.origin + '/api/streamed', stream: true},
        [channel.port2]
      );
      const message = await reply;
      return {
        streamed: !!message.stream,
        isStream: message.body instanceof ReadableStream,
        body: await new Response(message.body).json()
      };
    });
    t.ok(result.streamed, 'the streamed shape is flagged on the result');
    t.ok(result.isStream, 'the body arrived as a real transferred ReadableStream');
    t.equal(result.body.route, '/api/streamed', 'and it reads back through a Response');
  });
});
