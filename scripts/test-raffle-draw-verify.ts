import assert from 'node:assert/strict'
import {
  buildDrawLedger,
  encodeDrawRevealMemo,
  parseDrawRevealMemo,
  performDrawV1,
  pickWinnerIndexV1,
  verifyDraw,
  walletForTicketIndex,
  DRAW_ALGO_V1,
} from '../lib/raffles/draw'

const entries = [
  {
    id: 'b',
    wallet_address: 'WalletBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ticket_quantity: 2,
    status: 'confirmed',
    verified_at: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'a',
    wallet_address: 'WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ticket_quantity: 3,
    status: 'confirmed',
    verified_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'c',
    wallet_address: 'WalletCccccccccccccccccccccccccccccccccc',
    ticket_quantity: 1,
    status: 'pending',
  },
  {
    id: 'd',
    wallet_address: 'WalletAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ticket_quantity: 1,
    status: 'confirmed',
    refunded_at: '2026-01-03T00:00:00.000Z',
  },
]

const ledger = buildDrawLedger(entries)
assert.equal(ledger.soldCount, 5, 'pending + refunded excluded')
assert.equal(ledger.ranges.length, 2)
// Lexicographic: WalletA before WalletB
assert.equal(ledger.ranges[0]!.wallet.startsWith('WalletA'), true)
assert.equal(ledger.ranges[0]!.tickets, 3)
assert.equal(ledger.ranges[0]!.startIndex, 0)
assert.equal(ledger.ranges[0]!.endIndex, 3)
assert.equal(ledger.ranges[1]!.tickets, 2)
assert.equal(ledger.ranges[1]!.startIndex, 3)
assert.equal(ledger.ranges[1]!.endIndex, 5)

assert.equal(walletForTicketIndex(ledger.ranges, 0), ledger.ranges[0]!.wallet)
assert.equal(walletForTicketIndex(ledger.ranges, 2), ledger.ranges[0]!.wallet)
assert.equal(walletForTicketIndex(ledger.ranges, 3), ledger.ranges[1]!.wallet)
assert.equal(walletForTicketIndex(ledger.ranges, 4), ledger.ranges[1]!.wallet)
assert.equal(walletForTicketIndex(ledger.ranges, 5), null)

const seed = 'By8uYnrSXufy4gVaXi1E9qC8XNGq6FtFadxUTDgLZVUn'
const idx = pickWinnerIndexV1(seed, 5)
assert.ok(idx >= 0 && idx < 5)
assert.equal(pickWinnerIndexV1(seed, 5), idx, 'deterministic')

const draw = performDrawV1(entries, seed)
assert.equal(draw.algo, DRAW_ALGO_V1)
assert.equal(draw.soldCount, 5)
assert.equal(draw.winnerIndex, idx)
assert.equal(draw.ledgerHash, ledger.ledgerHash)
assert.equal(draw.winnerWallet, walletForTicketIndex(ledger.ranges, idx))

const memo = encodeDrawRevealMemo({
  algo: DRAW_ALGO_V1,
  raffleId: 'raffle-uuid-1',
  drawSeed: seed,
  soldCount: draw.soldCount,
  winnerIndex: draw.winnerIndex,
  ledgerHash: draw.ledgerHash,
})
const parsed = parseDrawRevealMemo(memo)
assert.ok(parsed)
assert.equal(parsed!.algo, DRAW_ALGO_V1)
assert.equal(parsed!.raffleId, 'raffle-uuid-1')
assert.equal(parsed!.drawSeed, seed)
assert.equal(parsed!.soldCount, 5)
assert.equal(parsed!.winnerIndex, draw.winnerIndex)
assert.equal(parsed!.ledgerHash, draw.ledgerHash)

const ok = verifyDraw({
  algo: DRAW_ALGO_V1,
  drawSeed: seed,
  soldCount: draw.soldCount,
  winnerIndex: draw.winnerIndex,
  winnerWallet: draw.winnerWallet,
  ledgerHash: draw.ledgerHash,
  entries,
})
assert.equal(ok.ok, true)

const bad = verifyDraw({
  algo: DRAW_ALGO_V1,
  drawSeed: seed,
  soldCount: draw.soldCount,
  winnerIndex: (draw.winnerIndex + 1) % draw.soldCount,
  winnerWallet: draw.winnerWallet,
  ledgerHash: draw.ledgerHash,
  entries,
})
assert.equal(bad.ok, false)

console.log('raffle draw verify ok')
