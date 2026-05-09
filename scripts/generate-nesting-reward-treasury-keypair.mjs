#!/usr/bin/env node
/**
 * Generate a dedicated Solana keypair for Owl Nesting OWL reward treasury.
 *
 * Usage: node scripts/generate-nesting-reward-treasury-keypair.mjs
 *    or: npm run generate:nesting-reward-treasury-key
 *
 * Copy NESTING_OWL_REWARD_TREASURY_SECRET_KEY into .env.local (never commit).
 * Use the printed public key for NESTING_OWL_REWARD_TREASURY_WALLET.
 */

import { Keypair } from '@solana/web3.js'

const keypair = Keypair.generate()
const secret = Array.from(keypair.secretKey)

console.log('New nesting OWL reward treasury keypair generated.\n')
console.log('Public key (reward treasury wallet):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Add these to .env.local (do NOT commit):')
console.log('')
console.log('NESTING_OWL_REWARD_TREASURY_WALLET=' + keypair.publicKey.toBase58())
console.log('NESTING_OWL_REWARD_TREASURY_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log('Fund this address with SOL for tx fees and OWL for reward payouts.')
