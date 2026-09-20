/**
 * Unit checks for $OWL pack checkout constants + fee label + verify helpers.
 * Run: npx tsx scripts/test-pack-owl-checkout.ts
 */
import assert from 'node:assert/strict'
import {
  PACK_OWL_USD_FEE,
  PACK_PRICE_OWL,
  PACK_PRICE_SOL,
  formatPackOwlFeeSolLabel,
  isPackPaymentCurrency,
} from '../lib/packs/config'
import { insufficientPackOwlMessage } from '../lib/packs/pack-purchase-errors'
import { packTokenBalanceDeltaForOwnerMint } from '../lib/packs/verify-payment'

function main() {
  assert.equal(PACK_PRICE_OWL, 20)
  assert.equal(PACK_OWL_USD_FEE, 1)
  assert.equal(PACK_PRICE_SOL, 0.1)
  assert.equal(isPackPaymentCurrency('OWL'), true)
  assert.equal(isPackPaymentCurrency('SOL'), true)
  assert.equal(isPackPaymentCurrency('USDC'), false)

  assert.match(formatPackOwlFeeSolLabel(null), /\$1 fee/)
  assert.match(formatPackOwlFeeSolLabel(0.005), /\+\$1 fee \(~0\.0050 SOL\)/)
  assert.match(formatPackOwlFeeSolLabel(0.012), /\+\$1 fee \(~0\.012 SOL\)/)

  const msg = insufficientPackOwlMessage({
    priceOwl: 20,
    haveOwl: 5,
    feeSol: 0.005,
    balanceLamports: 1_000_000,
  })
  assert.match(msg, /20/)
  assert.match(msg, /\$OWL/)
  assert.match(msg, /SOL/)

  const mint = 'OwlMint11111111111111111111111111111111111'
  const vault = 'Vault1111111111111111111111111111111111111'
  const delta = packTokenBalanceDeltaForOwnerMint(
    [{ mint, owner: vault, uiTokenAmount: { amount: '1000000' } }],
    [{ mint, owner: vault, uiTokenAmount: { amount: '21000000' } }],
    vault,
    mint
  )
  assert.equal(delta, 20_000_000n)

  const zero = packTokenBalanceDeltaForOwnerMint([], [], vault, mint)
  assert.equal(zero, 0n)

  console.log(
    JSON.stringify(
      {
        ok: true,
        priceOwl: PACK_PRICE_OWL,
        usdFee: PACK_OWL_USD_FEE,
        feeLabel: formatPackOwlFeeSolLabel(0.005),
        owlDelta: delta.toString(),
      },
      null,
      2
    )
  )
}

main()
