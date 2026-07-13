#!/usr/bin/env node
/**
 * Generate dedicated Discord marketplace wallets (escrow, payment receiver, OWL treasury).
 *
 * Usage:
 *   npm run generate:discord-marketplace-wallets
 *   node scripts/generate-discord-marketplace-wallets.mjs --write-env
 *
 * --write-env  Append marketplace vars to .env.local (never committed).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { Keypair } from '@solana/web3.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SECRETS_DIR = join(ROOT, '.secrets')
const SECRETS_FILE = join(SECRETS_DIR, 'discord-marketplace-wallets.json')
const ENV_LOCAL = join(ROOT, '.env.local')

function secretJson(kp) {
  return JSON.stringify(Array.from(kp.secretKey))
}

function makeWallet(label) {
  const keypair = Keypair.generate()
  return {
    label,
    publicKey: keypair.publicKey.toBase58(),
    secretKeyJson: secretJson(keypair),
  }
}

const writeEnv = process.argv.includes('--write-env')

const escrow = makeWallet('marketplace_escrow')
const payment = makeWallet('marketplace_payment')
const owlTreasury = makeWallet('marketplace_owl_treasury')

const payload = {
  generatedAt: new Date().toISOString(),
  network: 'mainnet — fund these addresses before production use',
  wallets: {
    escrow: {
      publicKey: escrow.publicKey,
      secretKeyJson: escrow.secretKeyJson,
      env: {
        DISCORD_MARKETPLACE_ESCROW_SECRET_KEY: escrow.secretKeyJson,
        DISCORD_MARKETPLACE_ESCROW_WALLET: escrow.publicKey,
      },
    },
    payment: {
      publicKey: payment.publicKey,
      secretKeyJson: payment.secretKeyJson,
      note: 'App only needs DISCORD_MARKETPLACE_PAYMENT_WALLET (pubkey). Keep secret offline to sweep buyer payments.',
      env: {
        DISCORD_MARKETPLACE_PAYMENT_WALLET: payment.publicKey,
      },
    },
    owlTreasury: {
      publicKey: owlTreasury.publicKey,
      secretKeyJson: owlTreasury.secretKeyJson,
      env: {
        DISCORD_MARKETPLACE_OWL_TREASURY_SECRET_KEY: owlTreasury.secretKeyJson,
      },
    },
  },
}

mkdirSync(SECRETS_DIR, { recursive: true })
writeFileSync(SECRETS_FILE, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 })

if (writeEnv) {
  const merge = spawnSync(process.execPath, [join(__dirname, 'merge-discord-marketplace-env.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (merge.status !== 0) process.exit(merge.status ?? 1)
}

console.log('Discord marketplace wallets generated.\n')
console.log('Escrow (inventory):     ', escrow.publicKey)
console.log('Payment (buyer funds):  ', payment.publicKey)
console.log('OWL treasury (points):  ', owlTreasury.publicKey)
console.log('')
console.log('Secrets saved to:', SECRETS_FILE)
if (writeEnv) {
  console.log('Env vars merged into:', ENV_LOCAL)
} else {
  console.log('Re-run with --write-env to append vars to .env.local')
}
console.log('')
console.log('Fund escrow + treasury with SOL for tx fees.')
console.log('Fund OWL treasury with OWL SPL for treasury-funded point bundles.')
console.log('Payment wallet only needs to receive SOL/OWL (no secret in server env).')
