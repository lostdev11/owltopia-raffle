#!/usr/bin/env node
/**
 * Merge OwlSwap vanity wallet + escrow env vars into .env.local from grind output.
 * Never prints secret keys — only public addresses.
 *
 * Prerequisite: npm run owlswap:grind-wallets
 *
 * Usage: npm run owlswap:install-env
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Keypair } from '@solana/web3.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, '.local')
const ENV_LOCAL = join(ROOT, '.env.local')

const ROLES = [
  {
    label: 'ops wallet',
    json: join(OUT_DIR, 'owlswap-wallet-keypair.json'),
    txt: join(OUT_DIR, 'owlswap-wallet-keypair.txt'),
    publicEnv: 'OWLSWAP_WALLET',
    secretEnv: 'OWLSWAP_SECRET_KEY',
  },
  {
    label: 'escrow',
    json: join(OUT_DIR, 'owlswap-escrow-keypair.json'),
    txt: join(OUT_DIR, 'owlswap-escrow-keypair.txt'),
    publicEnv: 'OWLSWAP_ESCROW_WALLET',
    secretEnv: 'OWLSWAP_ESCROW_SECRET_KEY',
  },
]

const ALL_KEYS = ROLES.flatMap((r) => [r.publicEnv, r.secretEnv])

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

function loadRole(role) {
  if (existsSync(role.json)) {
    const parsed = JSON.parse(readFileSync(role.json, 'utf8'))
    if (Array.isArray(parsed)) {
      const fromArray = keypairFromSecretArray(parsed)
      return { ...fromArray, source: role.json }
    }
    const publicKey = String(parsed.publicKey ?? '').trim()
    const secretKey = parsed.secretKey
    if (!publicKey || !Array.isArray(secretKey) || secretKey.length < 64) {
      throw new Error(`Invalid ${role.json} — re-run: npm run owlswap:grind-wallets`)
    }
    const derived = keypairFromSecretArray(secretKey)
    if (derived.publicKey !== publicKey) {
      throw new Error(`publicKey mismatch in ${role.json}`)
    }
    return { publicKey, secretKeyJson: derived.secretKeyJson, source: role.json }
  }

  if (existsSync(role.txt)) {
    const lines = readFileSync(role.txt, 'utf8').split('\n')
    const publicKey = lines
      .find((l) => l.startsWith('publicKey='))
      ?.slice('publicKey='.length)
      .trim()
    const secretLine = lines.find((l) => l.startsWith(`${role.secretEnv}=`))
    const secretKeyJson = secretLine?.slice(`${role.secretEnv}=`.length).trim()
    if (!publicKey || !secretKeyJson) {
      throw new Error(`Invalid ${role.txt} — re-run: npm run owlswap:grind-wallets`)
    }
    const secretKey = JSON.parse(secretKeyJson)
    const derived = keypairFromSecretArray(secretKey)
    if (derived.publicKey !== publicKey) {
      throw new Error(`publicKey mismatch in ${role.txt}`)
    }
    return { publicKey, secretKeyJson: derived.secretKeyJson, source: role.txt }
  }

  return null
}

function upsertEnv(content, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(content)) return content.replace(re, line)
  const trimmed = content.replace(/\s*$/, '')
  return trimmed ? `${trimmed}\n\n${line}\n` : `${line}\n`
}

function stripKeys(content, keys) {
  let out = content
  for (const key of keys) {
    out = out.replace(new RegExp(`^${key}=.*\\n?`, 'gm'), '')
  }
  return out.replace(/\n{3,}/g, '\n\n')
}

const loaded = []
for (const role of ROLES) {
  const kp = loadRole(role)
  if (!kp) {
    console.error(`Missing OwlSwap ${role.label} keypair.`)
    console.error('Run: npm run owlswap:grind-wallets')
    console.error('Expected:', role.json, 'or', role.txt)
    process.exit(1)
  }
  loaded.push({ role, ...kp })
}

let env = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, 'utf8') : ''
env = stripKeys(env, ALL_KEYS)

for (const item of loaded) {
  env = upsertEnv(env, item.role.publicEnv, item.publicKey)
  env = upsertEnv(env, item.role.secretEnv, item.secretKeyJson)
}

writeFileSync(ENV_LOCAL, env.endsWith('\n') ? env : env + '\n', { mode: 0o600 })

console.log('Merged OwlSwap env into .env.local (secrets not printed):\n')
for (const item of loaded) {
  console.log(`  ${item.role.publicEnv}=${item.publicKey}`)
  console.log(`  ${item.role.secretEnv}=[set from ${item.source}]`)
}
console.log('\nDo not commit .env.local or .local/owlswap-*-keypair.*')
console.log('Also add the same vars to Vercel when OwlSwap goes live.')
