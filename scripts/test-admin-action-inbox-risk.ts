/**
 * Regression checks for admin action inbox 2nd-round risk rules.
 * Run: npx --yes tsx scripts/test-admin-action-inbox-risk.ts
 */
import assert from 'node:assert/strict'
import { evaluateSecondRoundAtRisk } from '../lib/admin/action-inbox'

const now = new Date('2026-06-09T12:00:00.000Z')
const in36h = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString()
const in5d = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString()
const in10d = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString()

assert.deepEqual(
  evaluateSecondRoundAtRisk({
    status: 'live',
    end_time: in36h,
    time_extension_count: 1,
    minTickets: 100,
    ticketsSold: 40,
    now,
  }).atRisk,
  true,
  '48h rule triggers'
)

assert.deepEqual(
  evaluateSecondRoundAtRisk({
    status: 'live',
    end_time: in5d,
    time_extension_count: 1,
    minTickets: 100,
    ticketsSold: 20,
    now,
  }).atRisk,
  true,
  '25% + 7d rule triggers'
)

assert.deepEqual(
  evaluateSecondRoundAtRisk({
    status: 'live',
    end_time: in10d,
    time_extension_count: 1,
    minTickets: 100,
    ticketsSold: 20,
    now,
  }).atRisk,
  false,
  '25% but >7d left is not at risk'
)

assert.deepEqual(
  evaluateSecondRoundAtRisk({
    status: 'live',
    end_time: in5d,
    time_extension_count: 1,
    minTickets: 100,
    ticketsSold: 30,
    now,
  }).atRisk,
  false,
  '30% sold is not under 25% threshold'
)

assert.deepEqual(
  evaluateSecondRoundAtRisk({
    status: 'live',
    end_time: in5d,
    time_extension_count: 0,
    minTickets: 100,
    ticketsSold: 10,
    now,
  }).atRisk,
  false,
  'first round (no extension) excluded'
)

console.log('admin action inbox risk checks: OK')
