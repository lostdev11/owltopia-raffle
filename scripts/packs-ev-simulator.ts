import { simulatePackEv } from '../lib/packs/ev-simulator'
import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_OWL_TIERS,
  PACK_PRICE_SOL,
  PACK_SOL_TIERS,
  PACK_TARGET_EV_SOL,
} from '../lib/packs/config'
import {
  PACKS_PRODUCT_SLUG_MAIN,
  PACKS_PRODUCT_SLUG_OWL,
  PACK_OWL_CHECKOUT_OWL_TIERS,
} from '../lib/packs/product-pools'
import {
  pickCategory,
  pickTier,
  generatePackOpenSeed,
  hashPackOpenCommit,
} from '../lib/packs/rng'

const owlPriceArg = process.argv.find((a) => a.startsWith('--owl-sol='))
const owlSolPrice = owlPriceArg ? Number(owlPriceArg.split('=')[1]) : null
const feeArg = process.argv.find((a) => a.startsWith('--owl-fee-sol='))
const owlFeeSol = feeArg ? Number(feeArg.split('=')[1]) : 0.007

function printEv(label: string, result: ReturnType<typeof simulatePackEv>) {
  console.log(`\n=== ${label} ===`)
  console.log(`Shelf: ${result.productShelfSlug ?? 'n/a'}`)
  console.log(`Ticket (SOL-equiv): ${result.packPriceSol} SOL`)
  console.log(`Target EV (${result.targetRtpBps / 100}% RTP): ${result.targetEvSol.toFixed(6)} SOL`)
  console.log(`Estimated EV: ${result.estimatedEvSol.toFixed(6)} SOL`)
  console.log(`Estimated RTP: ${result.estimatedRtpBps} bps (${(result.estimatedRtpBps / 100).toFixed(1)}%)`)
  console.log('Category EV contributions:', result.categoryEv)
  for (const n of result.notes) console.log(`  - ${n}`)
}

const solResult = simulatePackEv({
  owlSolPrice: owlSolPrice && owlSolPrice > 0 ? owlSolPrice : null,
  productShelfSlug: PACKS_PRODUCT_SLUG_MAIN,
})
const owlResult = simulatePackEv({
  owlSolPrice: owlSolPrice && owlSolPrice > 0 ? owlSolPrice : null,
  paymentCurrency: 'OWL',
  paymentFeeSol: owlFeeSol,
  productShelfSlug: PACKS_PRODUCT_SLUG_OWL,
})

console.log('=== Owltopia Packs EV Simulator (separate shelves, same category %) ===')
printEv('Main shelf — 0.1 SOL checkout', solResult)
printEv('$OWL shelf — $OWL checkout', owlResult)

console.log('\nCategory weights (bps, shared):', PACK_CATEGORY_WEIGHTS_BPS)
console.log(
  'Main OWL tiers:',
  PACK_OWL_TIERS.map((t) => `${t.amount}@w${t.weight}`)
)
console.log(
  '$OWL shelf cash OWL tiers (same weights, smaller amounts):',
  PACK_OWL_CHECKOUT_OWL_TIERS.map((t) => `${t.amount}@w${t.weight}`)
)
console.log(
  'Main SOL tiers:',
  PACK_SOL_TIERS.map((t) => `${t.amountSol}@w${t.weight}`)
)

const N = 10_000
const catCounts = { owl: 0, sol: 0, nft: 0 }
for (let i = 0; i < N; i++) {
  const seed = generatePackOpenSeed()
  hashPackOpenCommit(seed)
  const c = pickCategory(seed)
  catCounts[c]++
  pickTier(seed, c, solResult.owlSolPrice)
}
console.log(`\nSimulated ${N} category rolls (same on all shelves):`, catCounts)

const driftSol = Math.abs(solResult.estimatedEvSol - PACK_TARGET_EV_SOL)
if (driftSol > 0.05) {
  console.error(`\nFAIL: SOL EV drift ${driftSol.toFixed(4)} > 0.05 from target`)
  process.exitCode = 1
} else {
  console.log(`\nOK: Main shelf EV within 0.05 SOL of target (pack ${PACK_PRICE_SOL} SOL)`)
}

const cheapOwl = simulatePackEv({
  owlSolPrice: 0.0025,
  paymentCurrency: 'OWL',
  paymentFeeSol: owlFeeSol,
  productShelfSlug: PACKS_PRODUCT_SLUG_OWL,
})
printEv('$OWL shelf @ 0.0025 SOL/OWL (cheap token + lower stock)', cheapOwl)
const cheapRtp = cheapOwl.estimatedRtpBps / 100
console.log(`\nNote: EV on $OWL shelf depends on deposited NFT floors, not category %.`)
