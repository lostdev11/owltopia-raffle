#!/usr/bin/env node
/**
 * Generate a Solana keypair that can be assigned as Owl Nest MPL Core FreezeDelegate authority.
 *
 * Important: this key only works after the Core collection/update/plugin authority can authorize it.
 * If the collection update authority is already set, that authority must delegate/plugin-authorize this key.
 */

import { Keypair } from '@solana/web3.js'

const keypair = Keypair.generate()
const secret = Array.from(keypair.secretKey)

console.log('New nesting MPL Core freeze authority keypair generated.\n')
console.log('Public key (authorize for MPL Core FreezeDelegate):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Add these to .env.local / Vercel (do NOT commit):')
console.log('')
console.log('NESTING_NFT_FREEZE_AUTHORITY_WALLET=' + keypair.publicKey.toBase58())
console.log('NESTING_NFT_FREEZE_AUTHORITY_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log('Fund this address with SOL. It pays fees when freezing/thawing nested Core NFTs.')
