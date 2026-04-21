#!/usr/bin/env node
/**
 * Generate a new Solana keypair dedicated to Owl Council OWL voting escrow (SPL custody).
 *
 * Usage: npm run generate:council-owl-escrow-key
 *
 * Copy COUNCIL_OWL_ESCROW_SECRET_KEY into .env.local (never commit).
 */
import { Keypair } from '@solana/web3.js'

const keypair = Keypair.generate()
const secret = Array.from(keypair.secretKey)

console.log('New Owl Council OWL escrow keypair generated.\n')
console.log('Public key (escrow wallet — OWL deposits go to this wallet’s OWL ATA):')
console.log(keypair.publicKey.toBase58())
console.log('')
console.log('Add this to .env.local (do NOT commit):')
console.log('')
console.log('COUNCIL_OWL_ESCROW_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log('Fund this address with SOL for tx fees. Users send OWL to its OWL SPL token account.')
console.log('Apply Supabase migration 075_owl_council_vote_escrow.sql before enabling council escrow voting.')
