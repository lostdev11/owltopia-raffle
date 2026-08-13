/**
 * Unit tests for partner presale pricing ($1 platform fee + partner proceeds).
 * Run: npx tsx scripts/test-owl-center-presale-pricing.ts
 */
import assert from 'node:assert/strict'

import { computeOwlCenterPurchaseLamports, lamportsForUsdcAmount } from '../lib/owl-center-presale/pricing'

const LAMPORTS_PER_SOL = 1_000_000_000
const solUsd = 100 // $100 / SOL for easy math

{
  const unit = lamportsForUsdcAmount(20, solUsd)
  assert.equal(unit, BigInt(Math.round((20 / 100) * LAMPORTS_PER_SOL)))
}

{
  const b = computeOwlCenterPurchaseLamports(
    { priceUsdc: 20, platformFeeUsdcPerSpot: 1, solUsdPrice: solUsd },
    3
  )
  assert.equal(b.unitPriceUsdc, 20)
  assert.equal(b.platformFeeUsdcPerSpot, 1)
  assert.equal(b.partnerLamports, lamportsForUsdcAmount(20, solUsd) * 3n)
  assert.equal(b.platformFeeLamports, lamportsForUsdcAmount(1, solUsd) * 3n)
  assert.equal(b.totalLamports, b.partnerLamports + b.platformFeeLamports)
  assert.equal(b.treasuryLamports, b.partnerLamports)
  assert.equal(b.unitLamports, b.unitPartnerLamports + b.unitPlatformFeeLamports)
}

{
  assert.throws(() =>
    computeOwlCenterPurchaseLamports({ priceUsdc: 10, platformFeeUsdcPerSpot: 1, solUsdPrice: solUsd }, 0)
  )
  assert.throws(() =>
    computeOwlCenterPurchaseLamports({ priceUsdc: 10, platformFeeUsdcPerSpot: 1, solUsdPrice: solUsd }, 1.5)
  )
}

console.log('owl-center-presale-pricing: ok')
