/**
 * Unit: ticket refund ledger source labels + coverage-stop heuristic.
 * Run: npx --yes tsx scripts/test-ticket-refund-ledger.ts
 */
import assert from 'node:assert/strict'
import {
  ticketRefundSourceLabel,
  TICKET_REFUND_LEDGER_SOURCES,
} from '../lib/db/ticket-refund-ledger'

assert.equal(ticketRefundSourceLabel('buyer_claim'), 'Claimed')
assert.equal(ticketRefundSourceLabel('auto_cron'), 'Auto')
assert.equal(ticketRefundSourceLabel('auto_finalize'), 'Auto')
assert.equal(ticketRefundSourceLabel('admin_send'), 'Admin')
assert.equal(ticketRefundSourceLabel('legacy_backfill'), 'Prior')
assert.ok(TICKET_REFUND_LEDGER_SOURCES.includes('buyer_claim'))

const COVERAGE_ERROR_RE = /cannot cover outstanding liability|Funds escrow is short|not configured/i
assert.ok(COVERAGE_ERROR_RE.test('Funds escrow cannot cover outstanding liability: SOL short ~0.3'))
assert.ok(COVERAGE_ERROR_RE.test('Funds escrow is short of SOL for this payout'))
assert.equal(COVERAGE_ERROR_RE.test('Refund lock not acquired'), false)

console.log('ok: ticket-refund-ledger labels + coverage stop heuristic')
