import { simulatePackEv } from '../lib/packs/ev-simulator'
import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_OWL_TIERS,
  PACK_PRICE_SOL,
  PACK_SOL_TIERS,
  PACK_TARGET_EV_SOL,
} from '../lib/packs/config'
import { pickCategory, pickTier, generatePackOpenSeed, hashPackOpenCommit } from '../lib/packs/rng'

const owlPriceArg = process.argv.find((a) => a.startsWith('--owl-sol='))
const owlSolPrice = owlPriceArg ? Number(owlPriceArg.split('=')[1]) : null

const result = simulatePackEv({ owlSolPrice: owlSolPrice && owlSolPrice > 0 ? owlSolPrice : null })

console.log('=== Owltopia Packs EV Simulator ===')
console.log(`Pack price: ${result.packPriceSol} SOL`)
console.log(`Target EV (80% RTP): ${result.targetEvSol} SOL`)
console.log(`Estimated EV: ${result.estimatedEvSol.toFixed(6)} SOL`)
console.log(`Estimated RTP: ${result.estimatedRtpBps} bps`)
console.log('Category EV contributions:', result.categoryEv)
console.log('OWL/SOL price used:', result.owlSolPrice)
console.log('Notes:')
for (const n of result.notes) console.log(`  - ${n}`)

console.log('\nCategory weights (bps):', PACK_CATEGORY_WEIGHTS_BPS)
console.log(
  'OWL tiers:',
  PACK_OWL_TIERS.map((t) => `${t.amount}@w${t.weight}`)
)
console.log(
  'SOL tiers:',
  PACK_SOL_TIERS.map((t) => `${t.amountSol}@w${t.weight}`)
)

// Sanity: RNG distribution over N opens
const N = 10_000
const catCounts = { owl: 0, sol: 0, nft: 0 }
for (let i = 0; i < N; i++) {
  const seed = generatePackOpenSeed()
  hashPackOpenCommit(seed)
  const c = pickCategory(seed)
  catCounts[c]++
  pickTier(seed, c, result.owlSolPrice)
}
console.log(`\nSimulated ${N} category rolls:`, catCounts)
console.log(
  'Empirical %:',
  Object.fromEntries(
    Object.entries(catCounts).map(([k, v]) => [k, ((100 * v) / N).toFixed(1) + '%'])
  )
)

const drift = Math.abs(result.estimatedEvSol - PACK_TARGET_EV_SOL)
if (drift > 0.05) {
  console.error(`\nFAIL: EV drift ${drift.toFixed(4)} > 0.05 from target`)
  process.exitCode = 1
} else {
  console.log(`\nOK: EV within 0.05 SOL of target (pack ${PACK_PRICE_SOL} SOL)`)
}
