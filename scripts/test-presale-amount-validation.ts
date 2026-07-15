/**
 * Presale amount validation regressions.
 * Underpaid amounts (and inflated client SOL/USD echoes) must not verify;
 * correctly priced founder/treasury payments must still verify.
 *
 * Run: npx tsx scripts/test-presale-amount-validation.ts
 */
import assert from 'node:assert/strict'
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js'
import type { ParsedTransactionWithMeta } from '@solana/web3.js'

import { computeGen2PresaleQuantityBoundsFromTotal, getVerifiedBreakdownForQuantity } from '../lib/gen2-presale/confirm-core'
import type { Gen2PresaleEnvConfig } from '../lib/gen2-presale/config'
import { computePurchaseLamports } from '../lib/gen2-presale/pricing'
import {
  resolveSolUsdAgainstOracle,
  unitLamportsBoundsFromOracle,
  SOL_USD_PRICE_TOLERANCE,
} from '../lib/gen2-presale/sol-usd-bounds'
import { verifyGen2PresalePaymentChainAligned, verifyGen2PresalePayments } from '../lib/gen2-presale/verify-payment'

const founderA = Keypair.generate().publicKey
const founderB = Keypair.generate().publicKey
const buyer = Keypair.generate().publicKey

const cfg: Gen2PresaleEnvConfig = {
  priceUsdc: 20,
  presaleSupply: 657,
  solUsdPrice: 150,
  founderA,
  founderB,
  founderAPercent: 50,
  founderBPercent: 50,
}

function mockTransferTx(
  from: PublicKey,
  transfers: { to: PublicKey; lamports: bigint }[]
): ParsedTransactionWithMeta {
  return {
    slot: 1,
    transaction: {
      message: {
        accountKeys: [
          { pubkey: from, signer: true, writable: true },
          ...transfers.map((t) => ({ pubkey: t.to, signer: false, writable: true })),
        ],
        instructions: transfers.map((t) => ({
          programId: SystemProgram.programId,
          parsed: {
            type: 'transfer',
            info: {
              source: from.toBase58(),
              destination: t.to.toBase58(),
              lamports: Number(t.lamports),
            },
          },
          program: 'system',
        })),
        recentBlockhash: '11111111111111111111111111111111',
      },
      signatures: ['sig'],
    },
    meta: { err: null, fee: 5000, preBalances: [], postBalances: [], innerInstructions: [] },
  } as unknown as ParsedTransactionWithMeta
}

// --- Client SOL/USD echo cannot widen the accepted band ---
{
  const oracle = 150
  assert.equal(resolveSolUsdAgainstOracle(oracle, undefined), oracle)
  assert.equal(resolveSolUsdAgainstOracle(oracle, 150), 150)
  // Inflated hint outside ±15% must fall back to oracle (never shrink expected lamports)
  assert.equal(resolveSolUsdAgainstOracle(oracle, 10_000), oracle)
  assert.equal(resolveSolUsdAgainstOracle(oracle, 1), oracle)
  // Within band is allowed for display/affinity helpers only
  const within = oracle * (1 + SOL_USD_PRICE_TOLERANCE * 0.5)
  assert.equal(resolveSolUsdAgainstOracle(oracle, within), within)
}

// --- Oracle-derived unit floor rejects material underpayment units ---
{
  const { unit, minUnit, maxUnit } = unitLamportsBoundsFromOracle(cfg.priceUsdc, cfg.solUsdPrice)
  assert.ok(unit > 0n)
  assert.ok(minUnit > BigInt(Math.ceil(0.0005 * LAMPORTS_PER_SOL)))
  assert.ok(minUnit < unit)
  assert.ok(maxUnit > unit)

  // Tiny payment totals must not map to many spots (old hard floor was 0.0005 SOL)
  const tiny = BigInt(Math.ceil(0.001 * LAMPORTS_PER_SOL))
  const bounds = computeGen2PresaleQuantityBoundsFromTotal(tiny, cfg)
  assert.equal(bounds, null, 'tiny payment must not produce quantity bounds vs oracle floor')
}

// --- Correctly priced payment verifies; underpayment does not ---
{
  const qty = 2
  const expected = computePurchaseLamports(cfg, qty)
  const goodTx = mockTransferTx(buyer, [
    { to: founderA, lamports: expected.founderALamports },
    { to: founderB, lamports: expected.founderBLamports },
  ])

  assert.equal(
    verifyGen2PresalePayments({
      parsed: goodTx,
      buyerWallet: buyer.toBase58(),
      founderA: founderA.toBase58(),
      founderB: founderB.toBase58(),
      expectA: expected.founderALamports,
      expectB: expected.founderBLamports,
    }).ok,
    true
  )

  const goodBreakdown = getVerifiedBreakdownForQuantity(cfg, buyer.toBase58(), goodTx, qty)
  assert.ok(goodBreakdown, 'correctly priced tx must confirm')
  assert.equal(goodBreakdown!.totalLamports, expected.totalLamports)

  // Material underpayment (25% of expected) must fail exact + chain-aligned checks
  const underTotal = expected.totalLamports / 4n
  const underA = underTotal / 2n
  const underB = underTotal - underA
  const underTx = mockTransferTx(buyer, [
    { to: founderA, lamports: underA },
    { to: founderB, lamports: underB },
  ])

  assert.equal(
    verifyGen2PresalePayments({
      parsed: underTx,
      buyerWallet: buyer.toBase58(),
      founderA: founderA.toBase58(),
      founderB: founderB.toBase58(),
      expectA: expected.founderALamports,
      expectB: expected.founderBLamports,
    }).ok,
    false
  )

  const chainUnder = verifyGen2PresalePaymentChainAligned({
    parsed: underTx,
    buyerWallet: buyer.toBase58(),
    founderA: founderA.toBase58(),
    founderB: founderB.toBase58(),
    pctA: cfg.founderAPercent,
    pctB: cfg.founderBPercent,
    priceUsdc: cfg.priceUsdc,
    quantity: qty,
    oracleSolUsd: cfg.solUsdPrice,
  })
  assert.equal(chainUnder.ok, false, 'underpaid chain-aligned path must fail')

  const underBreakdown = getVerifiedBreakdownForQuantity(cfg, buyer.toBase58(), underTx, qty)
  assert.equal(underBreakdown, null, 'underpaid tx must not verify for claimed quantity')
}

// --- Mild drift within tolerance still verifies via chain-aligned ---
{
  const qty = 1
  const expected = computePurchaseLamports(cfg, qty)
  const driftUnit = BigInt(Math.floor(Number(expected.unitLamports) * (1 - SOL_USD_PRICE_TOLERANCE * 0.5)))
  const driftA = driftUnit / 2n
  const driftB = driftUnit - driftA
  const driftTx = mockTransferTx(buyer, [
    { to: founderA, lamports: driftA },
    { to: founderB, lamports: driftB },
  ])

  const chainDrift = verifyGen2PresalePaymentChainAligned({
    parsed: driftTx,
    buyerWallet: buyer.toBase58(),
    founderA: founderA.toBase58(),
    founderB: founderB.toBase58(),
    pctA: cfg.founderAPercent,
    pctB: cfg.founderBPercent,
    priceUsdc: cfg.priceUsdc,
    quantity: qty,
    oracleSolUsd: cfg.solUsdPrice,
  })
  assert.equal(chainDrift.ok, true, 'within-tolerance drift must still verify')

  const driftBreakdown = getVerifiedBreakdownForQuantity(cfg, buyer.toBase58(), driftTx, qty)
  assert.ok(driftBreakdown, 'within-tolerance payment must still confirm')
}

console.log('test-presale-amount-validation: ok')
