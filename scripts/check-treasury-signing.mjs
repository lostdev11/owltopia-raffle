/**
 * Verify RAFFLE_RECIPIENT_SECRET_KEY matches RAFFLE_RECIPIENT_WALLET (buyout refunds / treasury payouts).
 *
 *   npm run check:treasury-signing
 *   node --env-file=.env.local scripts/check-treasury-signing.mjs
 */

import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

function parseTreasuryKeypair(raw) {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed) && parsed.length >= 64) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed))
    }
  } catch {
    // not JSON
  }
  try {
    return Keypair.fromSecretKey(bs58.decode(trimmed))
  } catch {
    return null
  }
}

const expected =
  process.env.RAFFLE_RECIPIENT_WALLET?.trim() ||
  process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET?.trim() ||
  ''

if (!expected) {
  console.error('Missing RAFFLE_RECIPIENT_WALLET (or NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET)')
  process.exit(1)
}

const raw = process.env.RAFFLE_RECIPIENT_SECRET_KEY
if (!raw?.trim()) {
  console.error('Missing RAFFLE_RECIPIENT_SECRET_KEY in .env.local')
  console.error('')
  console.error('Export the private key for treasury wallet:', expected)
  console.error('Add to .env.local (same format as PRIZE_ESCROW_SECRET_KEY), then re-run this script.')
  console.error('Also set RAFFLE_RECIPIENT_SECRET_KEY on Vercel Production and redeploy.')
  process.exit(1)
}

const kp = parseTreasuryKeypair(raw)
if (!kp) {
  console.error('RAFFLE_RECIPIENT_SECRET_KEY is set but could not be parsed (use JSON [..,..] or base58)')
  process.exit(1)
}

const derived = kp.publicKey.toBase58()
if (derived !== expected) {
  console.error('Key mismatch — signing would be disabled in production.')
  console.error('  RAFFLE_RECIPIENT_WALLET:     ', expected)
  console.error('  secret key derives to pubkey:  ', derived)
  process.exit(1)
}

console.log('OK – treasury signing configured')
console.log('  Wallet:', derived)
console.log('  Buyout refunds and winner payouts can be signed server-side.')
console.log('')
console.log('Next: set the same RAFFLE_RECIPIENT_SECRET_KEY on Vercel Production, redeploy, then:')
console.log('  BASE_URL=https://www.owltopia.xyz npm run check:treasury-signing-api')
