import { simulatePackEv } from '../lib/packs/ev-simulator'
import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_OWL_TIERS,
  PACK_PRICE_SOL,
  PACK_SOL_TIERS,
  PACK_TARGET_EV_SOL,
} from '../lib/packs/config'
import { PACK_ODDS_PROFILE_OWL } from '../lib/packs/odds-profiles'
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
  console.log(`Ticket (SOL-equiv): ${result.packPriceSol} SOL`)
  console.log(`Target EV (${result.targetRtpBps / 100}% RTP): ${result.targetEvSol.toFixed(6)} SOL`)
  console.log(`Estimated EV: ${result.estimatedEvSol.toFixed(6)} SOL`)
  console.log(`Estimated RTP: ${result.estimatedRtpBps} bps (${(result.estimatedRtpBps / 100).toFixed(1)}%)`)
  console.log('Category EV contributions:', result.categoryEv)
  for (const n of result.notes) console.log(`  - ${n}`)
}

const solResult = simulatePackEv({
  owlSolPrice: owlSolPrice && owlSolPrice > 0 ? owlSolPrice : null,
  paymentCurrency: 'SOL',
})
const owlResult = simulatePackEv({
  owlSolPrice: owlSolPrice && owlSolPrice > 0 ? owlSolPrice : null,
  paymentCurrency: 'OWL',
  paymentFeeSol: owlFeeSol,
})

console.log('=== Owltopia Packs EV Simulator ===')
printEv('SOL checkout (0.1 SOL pack)', solResult)
printEv('$OWL checkout (draft odds profile)', owlResult)

console.log('\nSOL category weights (bps):', PACK_CATEGORY_WEIGHTS_BPS)
console.log('OWL draft category weights (bps):', PACK_ODDS_PROFILE_OWL.categoryWeightsBps)
console.log(
  'SOL OWL tiers:',
  PACK_OWL_TIERS.map((t) => `${t.amount}@w${t.weight}`)
)
console.log(
  'OWL-path OWL tiers:',
  PACK_ODDS_PROFILE_OWL.owlTiers.map((t) => `${t.amount}@w${t.weight}`)
)
console.log(
  'SOL tiers (SOL path):',
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
console.log(`\nSimulated ${N} SOL-path category rolls:`, catCounts)

const driftSol = Math.abs(solResult.estimatedEvSol - PACK_TARGET_EV_SOL)
if (driftSol > 0.05) {
  console.error(`\nFAIL: SOL EV drift ${driftSol.toFixed(4)} > 0.05 from target`)
  process.exitCode = 1
} else {
  console.log(`\nOK: SOL EV within 0.05 SOL of target (pack ${PACK_PRICE_SOL} SOL)`)
}

const cheapOwl = simulatePackEv({
  owlSolPrice: 0.0025,
  paymentCurrency: 'OWL',
  paymentFeeSol: owlFeeSol,
})
printEv('$OWL checkout @ 0.0025 SOL/OWL (stress / cheap token)', cheapOwl)
const cheapRtp = cheapOwl.estimatedRtpBps / 100
if (cheapRtp < 75 || cheapRtp > 85) {
  console.error(
    `\nWARN: OWL-path RTP ${cheapRtp.toFixed(1)}% at 0.0025 SOL/OWL — target ~80% ±5 (retune PACK_ODDS_PROFILE_OWL)`
  )
  process.exitCode = 1
} else {
  console.log(`\nOK: OWL-path RTP ~${cheapRtp.toFixed(1)}% at 0.0025 SOL/OWL (draft profile)`)
}
