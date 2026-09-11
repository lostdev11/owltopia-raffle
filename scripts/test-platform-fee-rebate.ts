/**
 * Platform fee rebate math + state helpers.
 * Run: npx --yes tsx scripts/test-platform-fee-rebate.ts
 */
import assert from 'node:assert/strict'

import {
  OWL_CENTER_DEFAULT_PARTNER_PLATFORM_FEE_REBATE_BPS,
  clampPlatformFeeRebateBps,
  computePlatformFeeRebateLamports,
  isOwlCenterLaunchMintEndedForRebate,
  isPlatformFeeRebateEnabled,
} from '../lib/owl-center/platform-fee-rebate'

assert.equal(OWL_CENTER_DEFAULT_PARTNER_PLATFORM_FEE_REBATE_BPS, 2000)
assert.equal(clampPlatformFeeRebateBps(2000), 2000)
assert.equal(clampPlatformFeeRebateBps(-1), 0)
assert.equal(clampPlatformFeeRebateBps(50_000), 10_000)
assert.equal(clampPlatformFeeRebateBps('nope'), 0)

// 20% of 1_000_000_000 lamports = 200_000_000
assert.equal(computePlatformFeeRebateLamports(1_000_000_000n, 2000), 200_000_000n)
assert.equal(computePlatformFeeRebateLamports(1n, 2000), 0n) // floors
assert.equal(computePlatformFeeRebateLamports(5n, 2000), 1n)
assert.equal(computePlatformFeeRebateLamports(0n, 2000), 0n)
assert.equal(computePlatformFeeRebateLamports(1_000_000_000n, 0), 0n)

assert.equal(
  isPlatformFeeRebateEnabled({
    platform_fee_rebate_bps: 2000,
    platform_fee_rebate_wallet: 'DNoggcEL6DGdQAjaqxK7v5ktZchvXKtZdkaN6FPx2Fj1',
  }),
  true
)
assert.equal(
  isPlatformFeeRebateEnabled({
    platform_fee_rebate_bps: 2000,
    platform_fee_rebate_wallet: null,
  }),
  false
)
assert.equal(
  isPlatformFeeRebateEnabled({
    platform_fee_rebate_bps: 0,
    platform_fee_rebate_wallet: 'DNoggcEL6DGdQAjaqxK7v5ktZchvXKtZdkaN6FPx2Fj1',
  }),
  false
)

assert.equal(isOwlCenterLaunchMintEndedForRebate({ active_phase: 'SOLD_OUT' }), true)
assert.equal(isOwlCenterLaunchMintEndedForRebate({ active_phase: 'TRADING_ACTIVE' }), true)
assert.equal(isOwlCenterLaunchMintEndedForRebate({ status: 'SOLD_OUT' }), true)
assert.equal(
  isOwlCenterLaunchMintEndedForRebate({ active_phase: 'PUBLIC', minted_count: 100, total_supply: 100 }),
  true
)
assert.equal(
  isOwlCenterLaunchMintEndedForRebate({ active_phase: 'PUBLIC', minted_count: 50, total_supply: 100 }),
  false
)

console.log('ok — platform fee rebate')
