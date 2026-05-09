#!/usr/bin/env node
/**
 * Generate a dedicated Solana keypair for Owl Nesting NFT custody escrow.
 *
 * Usage: node scripts/generate-nesting-escrow-keypair.mjs
 *    or: npm run generate:nesting-escrow-key
 *
 * Copy NESTING_ESCROW_SECRET_KEY into .env.local (never commit).
 * Use the printed public key for NESTING_ESCROW_WALLET_ADDRESS.
 */

import { Keypair } from '@solana/web3.js'

const keypair = Keypair.generate()
const secret = Array.from(keypair.secretKey)

console.log('New nesting escrow keypair generated.\n')
console.log('Public key (nesting escrow address):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Add these to .env.local (do NOT commit):')
console.log('')
console.log('NESTING_ESCROW_WALLET_ADDRESS=' + keypair.publicKey.toBase58())
console.log('NESTING_ESCROW_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log('Fund this address with SOL. Then move custody NFTs into this wallet.')
