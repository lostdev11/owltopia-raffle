#!/usr/bin/env node
/**
 * Generate a Solana hot keypair for Owltopia Coin art upgrades (Option A).
 *
 * This key goes in Vercel as COIN_ART_UPGRADE_AUTHORITY_*. It can ONLY update
 * coin metadata after Gembird (collection update authority) adds it as an
 * additional UpdateDelegate on the Owltopia Coins collection:
 *
 *   node --env-file=.env.local scripts/authorize-coin-art-upgrade-delegate.mjs
 *
 * Do NOT commit the printed secret.
 */

import { Keypair } from '@solana/web3.js'

const keypair = Keypair.generate()
const secret = Array.from(keypair.secretKey)

console.log('New Owltopia Coin art-upgrade hot key generated.\n')
console.log('Public key (Gembird authorizes this as UpdateDelegate):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Add these to .env.local / Vercel (do NOT commit):')
console.log('')
console.log('COIN_ART_UPGRADE_AUTHORITY_WALLET=' + keypair.publicKey.toBase58())
console.log('COIN_ART_UPGRADE_AUTHORITY_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log('Fund this address with a little SOL (pays fees when updating coin URIs).')
console.log('')
console.log('Next — Gembird runs (with his collection authority secret, once):')
console.log('  COIN_ART_UPGRADE_AUTHORITY_WALLET=' + keypair.publicKey.toBase58() + ' \\')
console.log('  COIN_COLLECTION_UPDATE_AUTHORITY_SECRET_KEY=<gembird-secret> \\')
console.log('  node --env-file=.env.local scripts/authorize-coin-art-upgrade-delegate.mjs')
