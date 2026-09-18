/**
 * Partner public_simple: public wallet limit must not include allowlist-window mints.
 *
 * Run: npx --yes tsx scripts/test-public-simple-wallet-mint-count.ts
 */
import assert from 'node:assert/strict'

import { publicSimplePublicPhaseWalletMinted } from '../lib/owl-center/public-simple-wallet-mint-count'

console.log('publicSimplePublicPhaseWalletMinted:')

assert.equal(
  publicSimplePublicPhaseWalletMinted({ labeledPublicMinted: 5, allowlistUsedMints: 2 }),
  3,
  'WL 2 + labeled 5 → 3 toward public cap'
)

assert.equal(
  publicSimplePublicPhaseWalletMinted({ labeledPublicMinted: 2, allowlistUsedMints: 2 }),
  0,
  'only WL mints → 0 public usage'
)

assert.equal(
  publicSimplePublicPhaseWalletMinted({ labeledPublicMinted: 5, allowlistUsedMints: 0 }),
  5,
  'no WL usage → full labeled count'
)

assert.equal(
  publicSimplePublicPhaseWalletMinted({ labeledPublicMinted: 2, allowlistUsedMints: 5 }),
  0,
  'allowlist used > labeled never goes negative'
)

// Scenario from mint UI: WL 2/wallet + Public 5/wallet should allow 7 total.
{
  const publicLimit = 5
  const labeled = 5 // 2 WL + 3 public, all stored as PUBLIC
  const wlUsed = 2
  const towardPublic = publicSimplePublicPhaseWalletMinted({
    labeledPublicMinted: labeled,
    allowlistUsedMints: wlUsed,
  })
  assert.equal(towardPublic, 3)
  assert.equal(publicLimit - towardPublic, 2, '2 public spots remain (total 7 with WL)')
}

console.log('ok — public simple wallet mint count')
