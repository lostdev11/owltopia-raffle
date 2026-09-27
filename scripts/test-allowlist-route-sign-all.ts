/**
 * Regression: fee-payer-first signAll must offset mint indexes when an allowlist route is prepended.
 * Run: npx tsx scripts/test-allowlist-route-sign-all.ts
 */
import assert from 'node:assert/strict'
import { splitAllowlistRouteFromWalletSigned } from '../lib/solana/allowlist-route-sign-all'
import { candyGuardSimulationLooksLikeBotTax } from '../lib/solana/candy-guard-bot-tax'

const withRoute = splitAllowlistRouteFromWalletSigned(['route', 'mint0', 'mint1'], true)
assert.equal(withRoute.routeSigned, 'route')
assert.deepEqual(withRoute.mintWalletSigned, ['mint0', 'mint1'])

const withoutRoute = splitAllowlistRouteFromWalletSigned(['mint0', 'mint1'], false)
assert.equal(withoutRoute.routeSigned, null)
assert.deepEqual(withoutRoute.mintWalletSigned, ['mint0', 'mint1'])

const empty = splitAllowlistRouteFromWalletSigned([], true)
assert.equal(empty.routeSigned, null)
assert.deepEqual(empty.mintWalletSigned, [])

// Screenshot error copy — MissingAllowedListProof must surface as the user-facing bot-tax hint.
const hint = candyGuardSimulationLooksLikeBotTax([
  'Program log: AnchorError caused by account: proof. Error Code: MissingAllowedListProof.',
])
assert.equal(
  hint,
  'Mint would be rejected by the Candy Guard (MissingAllowedListProof) — you would only pay fees, not receive an NFT.'
)

console.log('ok — allowlist route signAll split + MissingAllowedListProof copy')
