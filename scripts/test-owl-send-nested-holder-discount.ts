/**
 * Nested Gen1/Gen2 counts drive Send/Swap holder discounts (not wallet holds alone).
 * Run: npx tsx scripts/test-owl-send-nested-holder-discount.ts
 */

import assert from 'node:assert/strict'
import { quoteOwlSendHolderDiscount } from '../lib/owl-send/holder-discount'

function check(name: string, cond: boolean) {
  assert.ok(cond, name)
  console.log('ok:', name)
}

const none = quoteOwlSendHolderDiscount({ gen1Count: 0, gen2Count: 0 })
check('zero nests → no discount', none.discountBps === 0)

const oneGen1 = quoteOwlSendHolderDiscount({ gen1Count: 1, gen2Count: 0 })
check('1 nested Gen1 → OwlHolder 10%', oneGen1.discountBps === 1000 && oneGen1.roleName === 'OwlHolder')

const gen2Whale = quoteOwlSendHolderDiscount({ gen1Count: 0, gen2Count: 10 })
check('10 nested Gen2 → OwlWhale 30%', gen2Whale.discountBps === 3000)

const bestOf = quoteOwlSendHolderDiscount({ gen1Count: 1, gen2Count: 20 })
check('best of Gen1/Gen2 ranks wins', bestOf.bestRank === Math.max(bestOf.gen1Rank, bestOf.gen2Rank))

console.log('test-owl-send-nested-holder-discount: ok')
