#!/usr/bin/env node
/**
 * Generate a Solana keypair for the Gen Owl monthly SOL/USDC rev-share pool
 * (dedicated wallet — not raffle funds escrow).
 *
 * Usage: node scripts/generate-gen-owl-rev-share-pool-keypair.mjs
 *
 * Copy into .env.local / Vercel (never commit the secret):
 *   GEN_OWL_REV_SHARE_POOL_WALLET=...
 *   GEN_OWL_REV_SHARE_POOL_SECRET_KEY=...
 */
import { Keypair } from '@solana/web3.js'

const keypair = Keypair.generate()
const secret = Array.from(keypair.secretKey)

console.log('New Gen Owl rev-share pool keypair generated.\n')
console.log('Public key (rev-share pool address):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Add this to .env.local and Vercel (do NOT commit):')
console.log('')
console.log('GEN_OWL_REV_SHARE_POOL_WALLET=' + keypair.publicKey.toBase58())
console.log('GEN_OWL_REV_SHARE_POOL_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log('Admin deposits SOL/USDC into this address from a connected wallet; claims pay from it.')
