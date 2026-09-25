/**
 * Unit checks for VRF fee-payer resolution (dedicated key preferred over escrow liability wallets).
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

function secretJson(kp: Keypair): string {
  return JSON.stringify(Array.from(kp.secretKey))
}

try {
  const vrfKp = Keypair.generate()
  const fundsKp = Keypair.generate()
  const prizeKp = Keypair.generate()

  process.env.VRF_FEE_PAYER_SECRET_KEY = secretJson(vrfKp)
  process.env.FUNDS_ESCROW_SECRET_KEY = secretJson(fundsKp)
  process.env.PRIZE_ESCROW_SECRET_KEY = secretJson(prizeKp)
  clearVrfFeePayerKeypairCacheForTests()

  assert.equal(getVrfFeePayerPublicKey(), vrfKp.publicKey.toBase58())
  assert.equal(
    resolveVrfOrRevealFeePayer()?.publicKey.toBase58(),
    vrfKp.publicKey.toBase58(),
    'dedicated VRF fee payer must win over prize/funds escrow'
  )

  delete process.env.VRF_FEE_PAYER_SECRET_KEY
  clearVrfFeePayerKeypairCacheForTests()
  assert.equal(getVrfFeePayerKeypair(), null)

  // Without dedicated key, fall back to funds escrow — never prize escrow (SOL prizes share that wallet).
  assert.equal(
    resolveVrfOrRevealFeePayer()?.publicKey.toBase58(),
    fundsKp.publicKey.toBase58(),
    'without VRF_FEE_PAYER_SECRET_KEY, funds escrow is last resort (not prize escrow)'
  )

  console.log('ok: VRF fee payer prefers VRF_FEE_PAYER_SECRET_KEY; never prize escrow')
} finally {
  if (originalVrf === undefined) delete process.env.VRF_FEE_PAYER_SECRET_KEY
  else process.env.VRF_FEE_PAYER_SECRET_KEY = originalVrf
  if (originalFunds === undefined) delete process.env.FUNDS_ESCROW_SECRET_KEY
  else process.env.FUNDS_ESCROW_SECRET_KEY = originalFunds
  if (originalPrize === undefined) delete process.env.PRIZE_ESCROW_SECRET_KEY
  else process.env.PRIZE_ESCROW_SECRET_KEY = originalPrize
  clearVrfFeePayerKeypairCacheForTests()
}
