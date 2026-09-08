#!/usr/bin/env node
/**
 * Generate a new Solana keypair for OwlSwap NFT escrow — dedicated key,
 * do NOT reuse prize escrow, funds escrow, or other treasury keys.
 *
 * Usage: node scripts/generate-owl-swap-escrow-keypair.mjs
 *    or: npm run generate:owl-swap-escrow-key
 *
 * Copy OWL_SWAP_ESCROW_SECRET_KEY into the deployment env (never commit).
 * Fund the public key with a little SOL for ATA rent before live deposits.
 */

import { Keypair } from '@solana/web3.js'

const keypair = Keypair.generate()
const secret = Array.from(keypair.secretKey)

console.log('New OwlSwap escrow keypair generated.\n')
console.log('Public key (OwlSwap deposit address):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Add this to .env.local / Vercel / host env (do NOT commit):')
console.log('')
console.log('OWL_SWAP_ESCROW_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log('Redeploy after setting the env. GET /api/owl-swap/escrow should return { address }.')
console.log('Fund this address with a little SOL so NFT ATAs can be created on deposit.')
