/**
 * Legacy pre-escrow NFT raffles must not block sell-out / scheduled draws.
 * Run: npx tsx scripts/test-legacy-raffle-draw-escrow.ts
 */
import assert from 'node:assert/strict'
import { raffleRequiresPrizeEscrowForDraw } from '../lib/raffles/visibility'
import type { Raffle } from '@/lib/types'

const since = '2025-06-01T00:00:00.000Z'
process.env.NEXT_PUBLIC_ESCROW_REQUIRED_SINCE = since

const legacyNft = {
  prize_type: 'nft',
  created_at: '2025-01-01T00:00:00.000Z',
} as Raffle

const newNft = {
  prize_type: 'nft',
  created_at: '2026-01-01T00:00:00.000Z',
} as Raffle

const crypto = {
  prize_type: 'crypto',
  created_at: '2025-01-01T00:00:00.000Z',
} as Raffle

assert.equal(raffleRequiresPrizeEscrowForDraw(legacyNft), false, 'legacy nft exempt from draw escrow gate')
assert.equal(raffleRequiresPrizeEscrowForDraw(newNft), true, 'new nft requires escrow for draw')
assert.equal(raffleRequiresPrizeEscrowForDraw(crypto), false, 'crypto never requires prize escrow')

console.log('legacy-raffle-draw-escrow: ok')
