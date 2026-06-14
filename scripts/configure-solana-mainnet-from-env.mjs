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

const setUrl = spawnSync('solana', ['config', 'set', '--url', rpc], { encoding: 'utf8' })
if (setUrl.status !== 0) {
  console.error(setUrl.stderr || setUrl.stdout)
  process.exit(setUrl.status ?? 1)
}

const setKey = spawnSync('solana', ['config', 'set', '--keypair', KEYPAIR_PATH], { encoding: 'utf8' })
if (setKey.status !== 0) {
  console.error(setKey.stderr || setKey.stdout)
  process.exit(setKey.status ?? 1)
}

const bal = spawnSync('solana', ['balance'], { encoding: 'utf8' })
console.log('Solana CLI configured for mainnet.')
console.log('Deployer:', kp.publicKey.toBase58())
console.log('Keypair:', KEYPAIR_PATH)
console.log((bal.stdout || bal.stderr || '').trim())
