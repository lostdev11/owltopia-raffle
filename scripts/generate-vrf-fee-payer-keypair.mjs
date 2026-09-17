#!/usr/bin/env node
/**
 * Generate a new Solana keypair for Switchboard VRF + reveal memo fees —
 * separate from funds escrow (ticket liability) and prize escrow (NFT custody).
 *
 * Usage: node scripts/generate-vrf-fee-payer-keypair.mjs
 *    or: npm run generate:vrf-fee-payer-key
 *
 * Copy VRF_FEE_PAYER_SECRET_KEY into .env.local / Vercel (never commit).
 * Fund with ~1–2 SOL working buffer for draws + pack opens.
 */

import { Keypair } from '@solana/web3.js'

const keypair = Keypair.generate()
const secret = Array.from(keypair.secretKey)

console.log('New VRF fee-payer keypair generated.\n')
console.log('Public key (VRF fee-payer address):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Add this to .env.local / Vercel (do NOT commit):')
console.log('')
console.log('VRF_FEE_PAYER_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log(
  'Fund this address with ~1–2 SOL for Switchboard create/commit/reveal + raffle memo fees.'
)
console.log('Do not use FUNDS_ESCROW or PRIZE_ESCROW keys here.')
