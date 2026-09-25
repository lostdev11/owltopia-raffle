/**
 * Unit checks for VRF fee-payer resolution (dedicated VRF wallet only — no escrow fallbacks).
 * Run: npx tsx scripts/test-vrf-fee-payer.ts
 */
import assert from 'node:assert/strict'
import { Keypair } from '@solana/web3.js'
import {
  clearVrfFeePayerKeypairCacheForTests,
  getVrfFeePayerKeypair,
  getVrfFeePayerPublicKey,
  resolveVrfOrRevealFeePayer,
} from '../lib/raffles/vrf-fee-payer'

const originalVrf = process.env.VRF_FEE_PAYER_SECRET_KEY
const originalFunds = process.env.FUNDS_ESCROW_SECRET_KEY
const originalPrize = process.env.PRIZE_ESCROW_SECRET_KEY
const originalExpected = process.env.VRF_FEE_PAYER_EXPECTED_WALLET

function secretJson(kp: Keypair): string {
  return JSON.stringify(Array.from(kp.secretKey))
}

try {
  const vrfKp = Keypair.generate()
  const fundsKp = Keypair.generate()
  const prizeKp = Keypair.generate()

  process.env.VRF_FEE_PAYER_SECRET_KEY = secretJson(vrfKp)
  process.env.VRF_FEE_PAYER_EXPECTED_WALLET = vrfKp.publicKey.toBase58()
  process.env.FUNDS_ESCROW_SECRET_KEY = secretJson(fundsKp)
  process.env.PRIZE_ESCROW_SECRET_KEY = secretJson(prizeKp)
  clearVrfFeePayerKeypairCacheForTests()

  assert.equal(getVrfFeePayerPublicKey(), vrfKp.publicKey.toBase58())
  assert.equal(
    resolveVrfOrRevealFeePayer()?.publicKey.toBase58(),
    vrfKp.publicKey.toBase58(),
    'dedicated VRF fee payer must be used when set'
  )

  delete process.env.VRF_FEE_PAYER_SECRET_KEY
  clearVrfFeePayerKeypairCacheForTests()
  assert.equal(getVrfFeePayerKeypair(), null)
  assert.equal(
    resolveVrfOrRevealFeePayer(),
    null,
    'without VRF_FEE_PAYER_SECRET_KEY there must be no funds/prize escrow fallback'
  )

  // Mismatched expected wallet → refuse key
  process.env.VRF_FEE_PAYER_SECRET_KEY = secretJson(vrfKp)
  process.env.VRF_FEE_PAYER_EXPECTED_WALLET = Keypair.generate().publicKey.toBase58()
  clearVrfFeePayerKeypairCacheForTests()
  assert.equal(getVrfFeePayerKeypair(), null, 'mismatched expected wallet must refuse VRF key')
  assert.equal(resolveVrfOrRevealFeePayer(), null)

  console.log('ok: VRF fees use VRF_FEE_PAYER_SECRET_KEY only (no escrow fallbacks)')
} finally {
  if (originalVrf === undefined) delete process.env.VRF_FEE_PAYER_SECRET_KEY
  else process.env.VRF_FEE_PAYER_SECRET_KEY = originalVrf
  if (originalFunds === undefined) delete process.env.FUNDS_ESCROW_SECRET_KEY
  else process.env.FUNDS_ESCROW_SECRET_KEY = originalFunds
  if (originalPrize === undefined) delete process.env.PRIZE_ESCROW_SECRET_KEY
  else process.env.PRIZE_ESCROW_SECRET_KEY = originalPrize
  if (originalExpected === undefined) delete process.env.VRF_FEE_PAYER_EXPECTED_WALLET
  else process.env.VRF_FEE_PAYER_EXPECTED_WALLET = originalExpected
  clearVrfFeePayerKeypairCacheForTests()
}
