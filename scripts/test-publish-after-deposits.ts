/**
 * Unit tests for raffle publish status vs start_time.
 * Run: npx tsx scripts/test-publish-after-deposits.ts
 */
import assert from 'node:assert/strict'
import { publicationStatusForStartTime } from '../lib/raffles/publication-status'

const now = Date.parse('2026-08-12T22:00:00.000Z')

assert.equal(publicationStatusForStartTime('2026-08-12T21:59:00.000Z', now), 'live')
assert.equal(publicationStatusForStartTime('2026-08-12T22:00:00.000Z', now), 'live')
assert.equal(publicationStatusForStartTime('2026-08-12T22:00:01.000Z', now), 'draft')
assert.equal(publicationStatusForStartTime('2026-08-13T10:00:00.000Z', now), 'draft')
assert.equal(publicationStatusForStartTime(null, now), 'live')
assert.equal(publicationStatusForStartTime('', now), 'live')
assert.equal(publicationStatusForStartTime('not-a-date', now), 'live')

console.log('test-publish-after-deposits: ok')
