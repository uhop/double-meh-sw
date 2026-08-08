// A deployable service worker, registered with {type: 'module'}. Bundle this file and serve the
// output from your origin: a module service worker does not resolve bare specifiers, so serving it
// verbatim fails registration — import '/node_modules/double-meh-sw/src/sw.js' by URL instead if
// you ship unbundled. Tune the options; everything is optional except the bundler URL if you want
// transparent bundling.
import {install} from 'double-meh-sw/sw.js';

install({
  version: '2026.07.04',
  cache: {cacheName: 'app-shared'},
  bundler: {url: '/bundle', match: '/api/'}
});
