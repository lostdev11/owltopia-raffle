/**
 * Mint dates default to UTC (with UTC suffix). Local mode still uses the viewer TZ.
 * Hub cards should use <LocalMintTime> so preference applies after hydration.
 */
import assert from 'node:assert/strict'
import { formatMintDate, formatPhaseStartShort } from '../lib/owl-center/phase-schedule'

const iso = '2026-09-05T11:30:00.000Z'

const prev = process.env.TZ
process.env.TZ = 'UTC'
{
  assert.equal(formatPhaseStartShort(iso, 'utc'), 'Sep 5, 11:30 AM UTC')
  assert.match(formatMintDate(iso, 'utc'), /Sep 5, 2026, 11:30 AM UTC/)
  // Default mode is UTC
  assert.match(formatMintDate(iso), /UTC$/)
}

process.env.TZ = 'America/New_York'
{
  assert.equal(formatPhaseStartShort(iso, 'local'), 'Sep 5, 7:30 AM')
  assert.match(formatMintDate(iso, 'local'), /Sep 5, 2026, 7:30 AM/)
  assert.doesNotMatch(formatMintDate(iso, 'local'), /UTC/)
  // Default still UTC even when process TZ is Eastern
  assert.match(formatMintDate(iso), /11:30 AM UTC/)
}

process.env.TZ = prev
console.log('test-mint-date-timezone: ok')
