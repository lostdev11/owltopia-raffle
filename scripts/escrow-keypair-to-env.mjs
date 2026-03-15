#!/usr/bin/env node
/**
 * Read a Solana keypair file and print the .env line for PRIZE_ESCROW_SECRET_KEY.
 * Use this if you generated the escrow keypair in PowerShell/CLI and saved it to a file.
 *
 * Usage (PowerShell or cmd):
 *   node scripts/escrow-keypair-to-env.mjs path/to/your-keypair.json
 *
 * The file can be:
 *   - JSON array of 64 numbers: [1,2,3,...,64]
 *   - A single line with base58 secret key (e.g. from Phantom export)
 *
 * This prints the public key (so you can confirm it matches your escrow address)
 * and the line to add to .env.local.
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { Keypair } from '@solana/web3.js'

const require = createRequire(import.meta.url)
const bs58 = require('bs58')

const path = process.argv[2]
if (!path) {
  console.error('Usage: node scripts/escrow-keypair-to-env.mjs <path-to-keypair.json>')
  process.exit(1)
}

let keypair
try {
  const raw = readFileSync(path, 'utf8').trim()
  const first = raw.charAt(0)
  if (first === '[') {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr) || arr.length < 64) {
      console.error('File must be a JSON array of 64 numbers.')
      process.exit(1)
    }
    keypair = Keypair.fromSecretKey(Uint8Array.from(arr))
  } else {
    keypair = Keypair.fromSecretKey(bs58.decode(raw))
  }
} catch (e) {
  console.error('Failed to read keypair file:', e.message)
  process.exit(1)
}

const pubkey = keypair.publicKey.toBase58()
const secret = Array.from(keypair.secretKey)

console.log('Public key (escrow address):')
console.log(pubkey)
console.log('')
console.log('Add this line to .env.local (do NOT commit):')
console.log('')
console.log('PRIZE_ESCROW_SECRET_KEY=' + JSON.stringify(secret))
console.log('')
console.log('If your escrow address is EjtYcA6aJq9G5fXixS6V1rk2Bqv3CExNCa7zmiemrfSK, the above public key must match.')
