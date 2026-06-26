#!/usr/bin/env node
/**
 * Point Solana CLI at mainnet RPC from .env.local and write Irys payer keypair for Sugar deploy.
 * Usage: node --env-file=.env.local scripts/configure-solana-mainnet-from-env.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { Keypair } from '@solana/web3.js'

const require = createRequire(import.meta.url)
const bs58Module = require('bs58')
const bs58Decode =
  typeof bs58Module.decode === 'function'
    ? bs58Module.decode.bind(bs58Module)
    : bs58Module.default.decode.bind(bs58Module.default)

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const KEYPAIR_PATH = join(ROOT, '.secrets', 'irys-mainnet-deployer.json')

const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim()
const key = process.env.IRYS_PRIVATE_KEY?.trim()

if (!rpc) {
  console.error('Missing NEXT_PUBLIC_SOLANA_RPC_URL in .env.local')
  process.exit(1)
}
if (!key) {
  console.error('Missing IRYS_PRIVATE_KEY in .env.local')
  process.exit(1)
}

let kp
try {
  kp = Keypair.fromSecretKey(bs58Decode(key))
} catch {
  try {
    kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(key)))
  } catch {
    console.error('IRYS_PRIVATE_KEY must be base58 or JSON byte array')
    process.exit(1)
  }
}

mkdirSync(join(ROOT, '.secrets'), { recursive: true })
writeFileSync(KEYPAIR_PATH, JSON.stringify(Array.from(kp.secretKey)))

// On Windows, spawnSync can't resolve the `solana` executable without a shell,
// which fails silently (status null, stdout/stderr undefined). Use a shell on
// win32 and quote dynamic args so RPC URLs / paths survive shell parsing.
const WIN = process.platform === 'win32'
const q = (s) => (WIN ? `"${s}"` : s)
const solana = (args) => spawnSync('solana', args, { encoding: 'utf8', shell: WIN })

const setUrl = solana(['config', 'set', '--url', q(rpc)])
if (setUrl.status !== 0) {
  console.error(setUrl.stderr || setUrl.stdout || setUrl.error?.message || 'solana not found on PATH')
  process.exit(setUrl.status ?? 1)
}

const setKey = solana(['config', 'set', '--keypair', q(KEYPAIR_PATH)])
if (setKey.status !== 0) {
  console.error(setKey.stderr || setKey.stdout || setKey.error?.message || 'solana not found on PATH')
  process.exit(setKey.status ?? 1)
}

const bal = solana(['balance'])
console.log('Solana CLI configured for mainnet.')
console.log('Deployer:', kp.publicKey.toBase58())
console.log('Keypair:', KEYPAIR_PATH)
console.log((bal.stdout || bal.stderr || '').trim())
