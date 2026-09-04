#!/usr/bin/env node
/**
 * Merge Owl Packs vault env vars into .env.local from the gitignored grind output.
 * Never prints the secret key — only the public vault address.
 *
 * Prerequisite: npm run packs:grind-vault  (writes .local/packs-vault-keypair.json)
 *
 * Usage: npm run packs:install-vault-env
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Keypair } from '@solana/web3.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const KEYPAIR_JSON = join(ROOT, '.local', 'packs-vault-keypair.json')
const KEYPAIR_TXT = join(ROOT, '.local', 'packs-vault-keypair.txt')
const ENV_LOCAL = join(ROOT, '.env.local')

const PACKS_KEYS = ['PACKS_VAULT_SECRET_KEY', 'NEXT_PUBLIC_PACKS_VAULT_WALLET']

function keypairFromSecretArray(secretKey) {
  if (!Array.isArray(secretKey) || secretKey.length < 64) {
    throw new Error('secretKey must be a JSON array of 64 bytes')
  }
  const kp = Keypair.fromSecretKey(Uint8Array.from(secretKey))
  return {
    publicKey: kp.publicKey.toBase58(),
    secretKeyJson: JSON.stringify(secretKey),
  }
}

function loadKeypair() {
  if (existsSync(KEYPAIR_JSON)) {
    const parsed = JSON.parse(readFileSync(KEYPAIR_JSON, 'utf8'))

    if (Array.isArray(parsed)) {
      const fromArray = keypairFromSecretArray(parsed)
      return { ...fromArray, source: KEYPAIR_JSON }
    }

    // Legacy grind output: { publicKey, secretKey, ... }
    const publicKey = String(parsed.publicKey ?? '').trim()
    const secretKey = parsed.secretKey
    if (!publicKey || !Array.isArray(secretKey) || secretKey.length < 64) {
      throw new Error(`Invalid ${KEYPAIR_JSON} — re-run: npm run packs:grind-vault`)
    }
    const derived = keypairFromSecretArray(secretKey)
    if (derived.publicKey !== publicKey) {
      throw new Error(
        `publicKey mismatch in ${KEYPAIR_JSON} — re-run: npm run packs:grind-vault`
      )
    }
    return { publicKey, secretKeyJson: derived.secretKeyJson, source: KEYPAIR_JSON }
  }

  if (existsSync(KEYPAIR_TXT)) {
    const lines = readFileSync(KEYPAIR_TXT, 'utf8').split('\n')
    const publicKey = lines
      .find((l) => l.startsWith('publicKey='))
      ?.slice('publicKey='.length)
      .trim()
    const secretLine = lines.find((l) => l.startsWith('PACKS_VAULT_SECRET_KEY='))
    const secretKeyJson = secretLine?.slice('PACKS_VAULT_SECRET_KEY='.length).trim()
    if (!publicKey || !secretKeyJson) {
      throw new Error(`Invalid ${KEYPAIR_TXT} — re-run: npm run packs:grind-vault`)
    }
    const secretKey = JSON.parse(secretKeyJson)
    const derived = keypairFromSecretArray(secretKey)
    if (derived.publicKey !== publicKey) {
      throw new Error(`publicKey mismatch in ${KEYPAIR_TXT} — re-run: npm run packs:grind-vault`)
    }
    return { publicKey, secretKeyJson: derived.secretKeyJson, source: KEYPAIR_TXT }
  }

  console.error('Missing packs vault keypair.')
  console.error('Run locally (never commit output): npm run packs:grind-vault')
  console.error('Expected:', KEYPAIR_JSON, 'or', KEYPAIR_TXT)
  process.exit(1)
}

function buildEnvBlock(keypair) {
  return [
    '# Owl Packs vault — receives pack purchase SOL and pays prizes. Buying stays paused until Admin → Turn packs on.',
    `# Installed from ${keypair.source.replace(ROOT, '.')}`,
    `NEXT_PUBLIC_PACKS_VAULT_WALLET=${keypair.publicKey}`,
    `PACKS_VAULT_SECRET_KEY=${keypair.secretKeyJson}`,
  ]
}

function isPacksVaultLine(line) {
  const t = line.trim()
  if (PACKS_KEYS.some((k) => t.startsWith(`${k}=`))) return true
  if (t.startsWith('# Owl Packs vault')) return true
  if (t.includes('vanity owL')) return true
  if (t.includes('Installed from .local/packs-vault-keypair')) return true
  if (t.includes('receives pack purchase SOL')) return true
  return false
}

function mergeEnvLocal(content, blockLines) {
  const lines = content.split('\n')
  const filtered = lines.filter((line) => !isPacksVaultLine(line))

  let insertAt = filtered.findIndex((l) => l.includes('NEXT_PUBLIC_RACE_ACCESS_MODE'))
  if (insertAt >= 0) {
    insertAt += 1
  } else {
    insertAt = filtered.length
  }

  const before = filtered.slice(0, insertAt)
  const after = filtered.slice(insertAt)
  while (before.length > 0 && before[before.length - 1]?.trim() === '') before.pop()
  while (after.length > 0 && after[0]?.trim() === '') after.shift()

  return [...before, '', ...blockLines, '', ...after].join('\n').replace(/\n{3,}/g, '\n\n')
}

const keypair = loadKeypair()
const blockLines = buildEnvBlock(keypair)
const existing = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, 'utf8') : ''
const merged = mergeEnvLocal(existing, blockLines)

writeFileSync(ENV_LOCAL, merged.endsWith('\n') ? merged : merged + '\n', { mode: 0o600 })

console.log('Merged Owl Packs vault vars into', ENV_LOCAL)
console.log('Vault address:', keypair.publicKey)
console.log('')
console.log('Next: restart `npm run dev`, open Admin → Packs, deposit NFTs.')
console.log('Do NOT turn packs on until you are ready for public purchases.')
console.log('Production: add the same two vars in Vercel (Settings → Environment Variables).')
