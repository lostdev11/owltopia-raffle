/**
 * Rev-share pool affordability preflight (blocks fee burn when pool is dry).
 * Run: npx tsx scripts/test-gen-owl-rev-share-pool-affordability.ts
 */
import assert from 'node:assert/strict'
import {
  evaluateGenOwlRevSharePoolAffordabilityFromBalances,
  GEN_OWL_REV_SHARE_SOL_FEE_BUFFER_LAMPORTS,
} from '../lib/nesting/gen-owl-rev-share-pool-affordability'

const feeSol = GEN_OWL_REV_SHARE_SOL_FEE_BUFFER_LAMPORTS / 1e9

// Matches the screenshot failure: need ~0.09207, hold ~0.00929
const short = evaluateGenOwlRevSharePoolAffordabilityFromBalances({
  amount_sol: 0.092053159,
  amount_usdc: 0,
  hold_sol: 0.00929,
  hold_usdc: 0,
})
assert.equal(short.ok, false)
assert.ok(short.error && /short of SOL/i.test(short.error))
assert.ok(Math.abs(short.need_sol - (0.092053159 + feeSol)) < 1e-9)
assert.ok(short.shortfall_sol > 0.08)

const funded = evaluateGenOwlRevSharePoolAffordabilityFromBalances({
  amount_sol: 0.092053159,
  amount_usdc: 0,
  hold_sol: 1,
  hold_usdc: 0,
})
assert.equal(funded.ok, true)
assert.equal(funded.error, null)

const usdcShort = evaluateGenOwlRevSharePoolAffordabilityFromBalances({
  amount_sol: 0,
  amount_usdc: 10,
  hold_sol: 1,
  hold_usdc: 2,
})
assert.equal(usdcShort.ok, false)
assert.ok(usdcShort.error && /short of USDC/i.test(usdcShort.error))

const combined = evaluateGenOwlRevSharePoolAffordabilityFromBalances({
  amount_sol: 0.5,
  amount_usdc: 1,
  hold_sol: 0.5 + feeSol * 2,
  hold_usdc: 1,
})
assert.equal(combined.ok, true)

const unconfigured = evaluateGenOwlRevSharePoolAffordabilityFromBalances({
  amount_sol: 1,
  amount_usdc: 0,
  hold_sol: null,
  hold_usdc: null,
  configured: false,
})
assert.equal(unconfigured.ok, false)
assert.ok(unconfigured.error && /not configured/i.test(unconfigured.error))

console.log('test-gen-owl-rev-share-pool-affordability: ok')
