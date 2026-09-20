/**
 * Partner wallet mint limit: raised ceiling + unlimited (= supply) helper.
 * Run: npx --yes tsx scripts/test-owl-center-wallet-mint-limit.ts
 */
import assert from 'node:assert/strict'

import {
  isOwlCenterWalletMintUnlimited,
  OWL_CENTER_MAX_WALLET_MINT_LIMIT,
} from '../lib/owl-center/launch-limits'
import { clampPartnerWalletMintLimit } from '../lib/owl-center/partner-allowlist-phases'
import { parseMintDetailsConfig } from '../lib/owl-center/launch-mint-config'
import { clampPublicSimpleWalletMintLimit } from '../lib/owl-center/sugar-public-simple-guards'

assert.equal(OWL_CENTER_MAX_WALLET_MINT_LIMIT, 10_000)
assert.equal(clampPublicSimpleWalletMintLimit(1010), 1010)
assert.equal(clampPublicSimpleWalletMintLimit(50), 50)
assert.equal(clampPublicSimpleWalletMintLimit(99_999), 10_000)
assert.equal(clampPartnerWalletMintLimit(1000), 1000)
assert.equal(clampPartnerWalletMintLimit(0), 1)
assert.equal(clampPartnerWalletMintLimit(undefined), 5)

assert.equal(isOwlCenterWalletMintUnlimited(1000, 1000), true)
assert.equal(isOwlCenterWalletMintUnlimited(1010, 1000), true)
assert.equal(isOwlCenterWalletMintUnlimited(5, 1000), false)
assert.equal(isOwlCenterWalletMintUnlimited(1000, 0), false)

const parsed = parseMintDetailsConfig({
  total_supply: 1000,
  mint_price: 0,
  currency: 'USDC',
  wallet_mint_limit: 1000,
})
assert.ok(!('error' in parsed))
assert.equal(parsed.wallet_mint_limit, 1000)

console.log('ok: owl-center wallet mint limit unlimited')
