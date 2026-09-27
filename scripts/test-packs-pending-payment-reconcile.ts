import assert from 'node:assert/strict'
import {
  buyerHasSignaturesAfterOpenCreated,
  filterSignaturesForOpen,
  groupPackOpensByBuyer,
  openCreatedAtSec,
  PACK_OPEN_PENDING_PAYMENT_MAX_AGE_MS,
  PACK_OPEN_PENDING_PAYMENT_MIN_AGE_MS,
  pendingPaymentReconcileWindowBounds,
  pickPendingOpenForOnChainPayment,
  shouldStopSignatureScanForBuyerBatch,
  sortPendingPaymentOpensNewestFirst,
} from '../lib/packs/pending-payment-reconcile-policy'
import { packOwlPaymentMatchesExactQuote } from '../lib/packs/verify-payment'
import type { PackOpenRow } from '../lib/packs/types'

const NOW = Date.UTC(2026, 8, 26, 23, 55, 0)

const window = pendingPaymentReconcileWindowBounds(NOW)
const minMs = NOW - PACK_OPEN_PENDING_PAYMENT_MAX_AGE_MS
const maxMs = NOW - PACK_OPEN_PENDING_PAYMENT_MIN_AGE_MS
assert.equal(window.minCreatedIso, new Date(minMs).toISOString())
assert.equal(window.maxCreatedIso, new Date(maxMs).toISOString())

function fakeOpen(id: string, createdIso: string, feeSol: number): PackOpenRow {
  return {
    id,
    product_id: 'ceb529a2-f327-48da-aac5-7cd282b85321',
    buyer_wallet: 'voMH6DuC2YdrMWmUFXf4uKZBU7Md3NEHZFwANLP8x4h',
    payment_signature: null,
    payment_currency: 'OWL',
    payment_owl_amount: 20,
    payment_fee_sol: feeSol,
    status: 'pending_payment',
    open_algo: 'owltopia-pack-open-v1',
    open_seed: null,
    open_commit_hash: null,
    category: null,
    prize_label: null,
    owl_amount: null,
    sol_amount: null,
    nft_inventory_id: null,
    nft_mint_address: null,
    fair_value_sol: null,
    free_ticket_credits: 0,
    payout_signature: null,
    is_jackpot_win: false,
    jackpot_contribution_sol: null,
    jackpot_amount_sol: null,
    error_message: null,
    created_at: createdIso,
    completed_at: null,
  }
}

const orphan = fakeOpen('ff78457e-a34e-4ea4-9caf-2f8927b66db1', '2026-09-26T23:48:00.000Z', 0.008234039)
const olderPending = fakeOpen('aaaa', '2026-09-26T23:40:00.000Z', 0.0081)
const ancient = fakeOpen('bbbb', '2026-08-31T12:00:00.000Z', 0.008234039)

const sorted = sortPendingPaymentOpensNewestFirst([olderPending, orphan, ancient])
assert.equal(sorted[0]!.id, orphan.id)

const inWindow = [orphan, olderPending].filter((o) => {
  const t = new Date(o.created_at).getTime()
  return t > minMs && t < maxMs
})
assert.equal(inWindow.length, 2)
assert.ok(!inWindow.some((o) => o.id === ancient.id))

const grouped = groupPackOpensByBuyer([orphan, olderPending, { ...olderPending, id: 'c', buyer_wallet: 'Other' }])
assert.equal(grouped.get(orphan.buyer_wallet.toLowerCase())?.length, 2)

assert.equal(
  packOwlPaymentMatchesExactQuote({
    vaultOwlDeltaRaw: 20_000_000n,
    vaultSolFeeReceivedSol: 0.008234039,
    expectedOwl: 20,
    expectedFeeSol: 0.008234039,
    owlDecimals: 6,
  }),
  true
)
assert.equal(
  packOwlPaymentMatchesExactQuote({
    vaultOwlDeltaRaw: 20_000_000n,
    vaultSolFeeReceivedSol: 0.008234039,
    expectedOwl: 20,
    expectedFeeSol: 0.0081,
    owlDecimals: 6,
  }),
  false
)

const paymentBlockTime = Math.floor(Date.parse('2026-09-26T23:55:00.000Z') / 1000)
const openA = fakeOpen('a', '2026-09-26T23:48:00.000Z', 0.008234039)
const openB = fakeOpen('b', '2026-09-26T23:52:00.000Z', 0.008234039)
const picked = pickPendingOpenForOnChainPayment([openA, openB], paymentBlockTime)
assert.equal(picked?.id, 'b')

const sigs = [
  { signature: 'new', blockTime: openCreatedAtSec(orphan) + 60 },
  { signature: 'old', blockTime: openCreatedAtSec(orphan) - 600 },
]
assert.equal(buyerHasSignaturesAfterOpenCreated(sigs, openCreatedAtSec(orphan)), true)
assert.equal(
  buyerHasSignaturesAfterOpenCreated([{ signature: 'x', blockTime: openCreatedAtSec(orphan) - 600 }], openCreatedAtSec(orphan)),
  false
)
assert.equal(shouldStopSignatureScanForBuyerBatch(sigs[1]!, openCreatedAtSec(orphan)), true)

const filtered = filterSignaturesForOpen(sigs, openCreatedAtSec(orphan))
assert.equal(filtered.length, 1)
assert.equal(filtered[0]!.signature, 'new')

console.log(JSON.stringify({ ok: true, tests: 'packs-pending-payment-reconcile' }))
