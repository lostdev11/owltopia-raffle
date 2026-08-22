#!/usr/bin/env node
/**
 * Convert legacy packs vault keypair JSON ({ publicKey, secretKey, ... }) to:
 *   .local/packs-vault-keypair.json  — standard Solana [64-byte] array (one line)
 *   .local/packs-vault-keypair.meta.json — public key + grind metadata
 *
 * Usage: npm run packs:normalize-vault-keypair
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Keypair } from '@solana/web3.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const KEYPAIR_JSON = join(ROOT, '.local', 'packs-vault-keypair.json')
const KEYPAIR_META = join(ROOT, '.local', 'packs-vault-keypair.meta.json')

if (!existsSync(KEYPAIR_JSON)) {
  console.error('Missing', KEYPAIR_JSON)
  process.exit(1)
}

const parsed = JSON.parse(readFileSync(KEYPAIR_JSON, 'utf8'))

if (Array.isArray(parsed)) {
  const kp = Keypair.fromSecretKey(Uint8Array.from(parsed))
  console.log('Already standard format. Public key:', kp.publicKey.toBase58())
  process.exit(0)
}

const secretKey = parsed.secretKey
if (!Array.isArray(secretKey) || secretKey.length < 64) {
  console.error('Invalid legacy keypair — re-run: npm run packs:grind-vault')
  process.exit(1)
}

const kp = Keypair.fromSecretKey(Uint8Array.from(secretKey))
const publicKey = kp.publicKey.toBase58()
const storedPublic = String(parsed.publicKey ?? '').trim()
if (storedPublic && storedPublic !== publicKey) {
  console.error('publicKey does not match secretKey — do not use this file')
  process.exit(1)
}

writeFileSync(KEYPAIR_JSON, JSON.stringify(secretKey), { mode: 0o600 })

const meta = {
  publicKey,
  ...(parsed.prefix ? { prefix: parsed.prefix } : {}),
  ...(parsed.attempts != null ? { attempts: parsed.attempts } : {}),
  ...(parsed.generatedAt ? { generatedAt: parsed.generatedAt } : {}),
  normalizedAt: new Date().toISOString(),
}
writeFileSync(KEYPAIR_META, JSON.stringify(meta, null, 2), { mode: 0o600 })

console.log('Normalized packs vault keypair to standard [64] format')
console.log('Public key:', publicKey)
console.log('Wrote:', KEYPAIR_JSON.replace(ROOT, '.'))
console.log('Wrote:', KEYPAIR_META.replace(ROOT, '.'))
console.log('Next: npm run packs:install-vault-env')
