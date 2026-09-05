/**
 * Regression: hub cards previously called formatMintDate during SSR (UTC on Vercel),
 * so Eastern viewers saw 11:30 AM when the mint console (client) correctly showed 7:30 AM.
 */
import assert from 'node:assert/strict'
import { formatMintDate, formatPhaseStartShort } from '../lib/owl-center/phase-schedule'

const iso = '2026-09-05T11:30:00.000Z'

const prev = process.env.TZ
process.env.TZ = 'UTC'
{
  // Re-require isn't needed — Date uses process.env.TZ at call time in Node.
  assert.equal(formatPhaseStartShort(iso), 'Sep 5, 11:30 AM')
  assert.match(formatMintDate(iso), /Sep 5, 2026, 11:30 AM/)
}

process.env.TZ = 'America/New_York'
{
  assert.equal(formatPhaseStartShort(iso), 'Sep 5, 7:30 AM')
  assert.match(formatMintDate(iso), /Sep 5, 2026, 7:30 AM/)
}

process.env.TZ = prev
console.log('test-mint-date-timezone: ok')
