// A deployable service worker: serve this file from your origin and register it with
// {type: 'module'}. Tune the options; everything is optional except the bundler URL if you
// want transparent bundling.
import {install} from 'double-meh-sw/sw.js';

install({
  version: '2026.07.04',
  cache: {cacheName: 'app-shared'},
  bundler: {url: '/bundle', match: '/api/'}
});
