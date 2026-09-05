/**
 * Pack claim payment error UX helpers.
 * Run: npx tsx scripts/test-pack-purchase-errors.ts
 */
import assert from 'node:assert/strict'
import {
  friendlyPackPaymentError,
  formatPackSolAmount,
  isPackPriceMismatch,
  packPaymentLamportsNeeded,
  parseInsufficientLamports,
  insufficientPackSolMessage,
  softPackFundHint,
} from '../lib/packs/pack-purchase-errors'

function main() {
  // Screenshot-style Solana system transfer failure (~0.053 SOL wallet, 0.1 SOL pack).
  const raw =
    'Transaction would fail on-chain before wallet approval.\n' +
    'Program 11111111111111111111111111111111 invoke [1]\n' +
    'Transfer: insufficient lamports 53486077, need 100000000\n' +
    'Program 11111111111111111111111111111111 failed: custom program error: 0x1'

  const parsed = parseInsufficientLamports(raw)
  assert.ok(parsed)
  assert.equal(parsed!.haveLamports, 53_486_077)
  assert.equal(parsed!.needLamports, 100_000_000)

  const friendly = friendlyPackPaymentError(new Error(raw), {
    priceSol: 0.1,
    balanceLamports: 53_486_077,
  })
  assert.match(friendly, /Not enough SOL to claim this pack/i)
  assert.match(friendly, /0\.053/)
  assert.doesNotMatch(friendly, /Program 1111/)
  assert.doesNotMatch(friendly, /invoke \[1\]/)

  // 1 SOL need (possible price drift / misconfig) still maps cleanly.
  const oneSolRaw =
    'Transaction would fail on-chain before wallet approval.\n' +
    'Transfer: insufficient lamports 53486077, need 1000000000'
  const oneSol = friendlyPackPaymentError(oneSolRaw, {
    priceSol: 0.1,
    balanceLamports: 53_486_077,
  })
  assert.match(oneSol, /Not enough SOL to claim this pack/i)
  assert.doesNotMatch(oneSol, /Program /)

  // Pre-check copy for underfunded wallet at 0.1 SOL pack.
  const pre = insufficientPackSolMessage({
    priceSol: 0.1,
    balanceLamports: 53_486_077,
  })
  assert.match(pre, /0\.1/)
  assert.match(pre, /0\.053/)

  const hint = softPackFundHint({ priceSol: 0.1, balanceLamports: 53_486_077 })
  assert.equal(hint, pre)

  // Fee buffer included in needed lamports.
  const needed = packPaymentLamportsNeeded(0.1)
  assert.equal(needed, 100_000_000 + 20_000)

  // Price mismatch guard (0.1 UI vs 1.0 checkout).
  assert.equal(isPackPriceMismatch(0.1, 1.0), true)
  assert.equal(isPackPriceMismatch(0.1, 0.1), false)
  assert.equal(isPackPriceMismatch(0.1, 0.1005), false)

  // Wallet rejection.
  assert.equal(
    friendlyPackPaymentError(new Error('User rejected the request')),
    'Payment cancelled in wallet.'
  )

  // Formatting sanity.
  assert.equal(formatPackSolAmount(0), '0')
  assert.match(formatPackSolAmount(0.053486077), /0\.053/)

  console.log(
    JSON.stringify(
      {
        ok: true,
        packPurchaseErrors: true,
        sampleFriendly: friendly,
      },
      null,
      2
    )
  )
}

main()
