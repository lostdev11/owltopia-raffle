/**
 * Run: npx tsx scripts/test-browser-url-sync.ts
 */
import assert from 'node:assert/strict'
import { buildPathHashUrl, buildSyncedBrowserUrl } from '../lib/client/browser-url-sync'

assert.equal(
  buildSyncedBrowserUrl({
    routerPathname: '/raffles/owl-drop',
    routerSearch: '',
    browserPathname: '/raffles/owl-drop',
  }),
  null,
  'matching path needs no sync'
)

assert.equal(
  buildSyncedBrowserUrl({
    routerPathname: '/raffles/owl-drop',
    routerSearch: '',
    browserPathname: '/nesting',
  }),
  '/raffles/owl-drop',
  'stale previous path must sync to router path'
)

assert.equal(
  buildSyncedBrowserUrl({
    routerPathname: '/raffles/owl-drop',
    routerSearch: 'ref=abc',
    browserPathname: '/dashboard',
  }),
  '/raffles/owl-drop?ref=abc',
  'sync must use router search, not stale bar'
)

assert.equal(buildPathHashUrl('/nesting', 'perches'), '/nesting#perches')
assert.equal(buildPathHashUrl('/nesting', '#perches'), '/nesting#perches')
assert.equal(
  buildPathHashUrl('/owl-center/collection/gen2', 'wl'),
  '/owl-center/collection/gen2#wl'
)

console.log('ok: browser URL sync helpers')
