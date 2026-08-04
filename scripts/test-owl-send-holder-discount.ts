/**
 * Unit tests for OwlSend Owltopia holder fee discount (Discord role ladders).
 * Run: npx tsx scripts/test-owl-send-holder-discount.ts
 */
import assert from 'node:assert/strict'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import {
  applyOwlSendFeeDiscountLamports,
  OWL_SEND_GEN1_ROLE_THRESHOLDS,
  OWL_SEND_GEN2_ROLE_THRESHOLDS,
  owlSendRoleRankFromCount,
  quoteOwlSendHolderDiscount,
} from '@/lib/owl-send/holder-discount'
import { buildOwlSendCostEstimate } from '@/lib/owl-send/cost-estimate'
import { getOwlSendFeeLamports, getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'

assert.deepEqual([...OWL_SEND_GEN1_ROLE_THRESHOLDS], [1, 3, 5, 10, 20, 30])
assert.deepEqual([...OWL_SEND_GEN2_ROLE_THRESHOLDS], [1, 5, 10, 20, 30, 60])

assert.equal(owlSendRoleRankFromCount(0, OWL_SEND_GEN1_ROLE_THRESHOLDS), 0)
assert.equal(owlSendRoleRankFromCount(1, OWL_SEND_GEN1_ROLE_THRESHOLDS), 1)
assert.equal(owlSendRoleRankFromCount(2, OWL_SEND_GEN1_ROLE_THRESHOLDS), 1)
assert.equal(owlSendRoleRankFromCount(3, OWL_SEND_GEN1_ROLE_THRESHOLDS), 2)
assert.equal(owlSendRoleRankFromCount(5, OWL_SEND_GEN1_ROLE_THRESHOLDS), 3)
assert.equal(owlSendRoleRankFromCount(10, OWL_SEND_GEN1_ROLE_THRESHOLDS), 4)
assert.equal(owlSendRoleRankFromCount(20, OWL_SEND_GEN1_ROLE_THRESHOLDS), 5)
assert.equal(owlSendRoleRankFromCount(30, OWL_SEND_GEN1_ROLE_THRESHOLDS), 6)
assert.equal(owlSendRoleRankFromCount(99, OWL_SEND_GEN1_ROLE_THRESHOLDS), 6)

assert.equal(owlSendRoleRankFromCount(4, OWL_SEND_GEN2_ROLE_THRESHOLDS), 1)
assert.equal(owlSendRoleRankFromCount(5, OWL_SEND_GEN2_ROLE_THRESHOLDS), 2)
assert.equal(owlSendRoleRankFromCount(60, OWL_SEND_GEN2_ROLE_THRESHOLDS), 6)

// Gen1 scarce: 3 Gen1 = LilWhale (20%); needs 5 Gen2 for same rank
const g1 = quoteOwlSendHolderDiscount({ gen1Count: 3, gen2Count: 0 })
assert.equal(g1.bestRank, 2)
assert.equal(g1.roleName, 'OwlLilWhale')
assert.equal(g1.discountBps, 2_000)
assert.equal(g1.discountPercent, 20)

const g2 = quoteOwlSendHolderDiscount({ gen1Count: 0, gen2Count: 5 })
assert.equal(g2.bestRank, 2)
assert.equal(g2.discountBps, 2_000)

// Best of both ranks
const mixed = quoteOwlSendHolderDiscount({ gen1Count: 1, gen2Count: 20 })
assert.equal(mixed.gen1Rank, 1)
assert.equal(mixed.gen2Rank, 4)
assert.equal(mixed.bestRank, 4)
assert.equal(mixed.roleName, 'OwlCEO')
assert.equal(mixed.discountBps, 4_000)

const founder = quoteOwlSendHolderDiscount({ gen1Count: 20, gen2Count: 0 })
assert.equal(founder.discountBps, 5_000)
const gembird = quoteOwlSendHolderDiscount({ gen1Count: 30, gen2Count: 0 })
assert.equal(gembird.roleName, 'GEMBIRD')
assert.equal(gembird.discountBps, 5_000)

const base = getOwlSendFeeLamports()
assert.equal(base, Math.round(0.001 * LAMPORTS_PER_SOL))
assert.equal(getOwlSendFeeLamportsForCount(5), base * 5)
assert.equal(getOwlSendFeeLamportsForCount(5, 0), base * 5)
assert.equal(getOwlSendFeeLamportsForCount(5, 1_000), Math.floor((base * 9_000) / 10_000) * 5)
assert.equal(getOwlSendFeeLamportsForCount(1, 5_000), Math.floor(base / 2))
assert.equal(applyOwlSendFeeDiscountLamports(base, 3, 3_000), Math.floor((base * 7_000) / 10_000) * 3)

const cost = buildOwlSendCostEstimate({ nftCount: 10, batchCount: 2, discountBps: 2_000 })
assert.ok(cost)
assert.equal(cost!.discountBps, 2_000)
assert.equal(cost!.discountPercent, 20)
assert.ok(cost!.feePerNftSol < cost!.baseFeePerNftSol)
assert.ok(cost!.feeLabel.includes('20% holder discount'))

console.log('test-owl-send-holder-discount: ok')
