/**
 * Unit checks for Owl Center batch mint SOL budget helpers.
 */
import assert from 'node:assert/strict'

import {
  affordableOwlCenterMintQuantity,
  capMintableByOwlCenterSolBudget,
  owlCenterMintSolNeededPerNftLamports,
  scaleOwlCenterMintSolNeededLamports,
} from '@/lib/owl-center/mint-sol-budget'

function main() {
  const perNft = owlCenterMintSolNeededPerNftLamports({
    platformFeeLamports: 5_000_000n,
    rentReservePerNftLamports: 10_000_000n,
    mintPriceLamportsPerNft: 100_000_000n,
  })
  assert.equal(perNft, 115_000_000n)

  assert.equal(scaleOwlCenterMintSolNeededLamports(perNft, 7), 805_000_000n)
  assert.equal(scaleOwlCenterMintSolNeededLamports(String(perNft), 1), perNft)

  assert.equal(affordableOwlCenterMintQuantity(805_000_000n, perNft), 7)
  assert.equal(affordableOwlCenterMintQuantity(804_999_999n, perNft), 6)
  assert.equal(affordableOwlCenterMintQuantity(114_999_999n, perNft), 0)
  assert.equal(affordableOwlCenterMintQuantity(null, perNft), null)

  const capped = capMintableByOwlCenterSolBudget({
    maxMintable: 15,
    isEligible: true,
    reason: 'Eligible for public · up to 15 mints (0/10 this phase)',
    walletBalanceLamports: 805_000_000n,
    perNftNeededLamports: perNft,
  })
  assert.equal(capped.maxMintable, 7)
  assert.equal(capped.isEligible, true)
  assert.match(capped.reason ?? '', /SOL balance limits batch size/)
  assert.match(capped.reason ?? '', /up to 7 mints/)

  const underfunded = capMintableByOwlCenterSolBudget({
    maxMintable: 5,
    isEligible: true,
    reason: 'Eligible',
    walletBalanceLamports: 1_000_000n,
    perNftNeededLamports: perNft,
  })
  assert.equal(underfunded.maxMintable, 0)
  assert.equal(underfunded.isEligible, false)
  assert.match(underfunded.reason ?? '', /Need ~/i)

  console.log('test-mint-sol-budget: ok')
}

main()
