#!/usr/bin/env node
/**
 * Generate a new Solana keypair for the prize escrow.
 * Run once per environment (e.g. once for devnet, once for mainnet).
 *
 * Usage: node scripts/generate-escrow-keypair.mjs
 *
 * Copy the "PRIZE_ESCROW_SECRET_KEY" line into .env.local (never commit it).
 * Fund the public key with a little SOL (devnet faucet or mainnet) so it can pay for transfers.
 */

import { Keypair } from '@solana/web3.js'

const keypair = Keypair.generate()
const secret = Array.from(keypair.secretKey)

console.log('New prize escrow keypair generated.\n')
console.log('Public key (escrow address):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Add this to .env.local (do NOT commit):')
console.log('')
console.log('PRIZE_ESCROW_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log('Then fund the address above with SOL (devnet: https://faucet.solana.com)')
