#!/usr/bin/env node
/**
 * Generate a new Solana keypair for ticket proceeds (funds) escrow — separate from prize NFT escrow.
 *
 * Usage: node scripts/generate-funds-escrow-keypair.mjs
 *    or: npm run generate:funds-escrow-key
 *
 * Copy FUNDS_ESCROW_SECRET_KEY into .env.local (never commit).
 */

import { Keypair } from '@solana/web3.js'

const keypair = Keypair.generate()
const secret = Array.from(keypair.secretKey)

console.log('New funds escrow keypair generated.\n')
console.log('Public key (funds escrow address):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Add this to .env.local (do NOT commit):')
console.log('')
console.log('FUNDS_ESCROW_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log('Fund this address with SOL. For USDC/OWL tickets, ensure the escrow can hold those tokens.')
