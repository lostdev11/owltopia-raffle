#!/usr/bin/env node
/**
 * Merge Discord marketplace wallet env vars into .env.local from .secrets/discord-marketplace-wallets.json.
 * Does not regenerate keys — run generate:discord-marketplace-wallets first if missing.
 *
 * Usage: npm run merge:discord-marketplace-env
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SECRETS_FILE = join(ROOT, '.secrets', 'discord-marketplace-wallets.json')
const ENV_LOCAL = join(ROOT, '.env.local')

const MARKETPLACE_KEYS = [
  'DISCORD_MARKETPLACE_ESCROW_SECRET_KEY',
  'DISCORD_MARKETPLACE_ESCROW_WALLET',
  'DISCORD_MARKETPLACE_PAYMENT_WALLET',
  'DISCORD_MARKETPLACE_OWL_TREASURY_SECRET_KEY',
]

function buildEnvBlock(secrets) {
  const { escrow, payment, owlTreasury } = secrets.wallets
  const generatedAt = secrets.generatedAt ?? 'unknown'
  return [
    '# Discord shop (/owltopia-shop) — dedicated marketplace wallets (migration 190–193).',
    `# Generated ${generatedAt}. Escrow + treasury need SOL; treasury needs OWL for point bundles.`,
    `DISCORD_MARKETPLACE_ESCROW_SECRET_KEY=${escrow.secretKeyJson}`,
    `DISCORD_MARKETPLACE_ESCROW_WALLET=${escrow.publicKey}`,
    `DISCORD_MARKETPLACE_PAYMENT_WALLET=${payment.publicKey}`,
    `DISCORD_MARKETPLACE_OWL_TREASURY_SECRET_KEY=${owlTreasury.secretKeyJson}`,
    '# Admin UI: /admin/discord-shop',
  ]
}

function isMarketplaceLine(line) {
  const t = line.trim()
  if (MARKETPLACE_KEYS.some((k) => t.startsWith(`${k}=`))) return true
  if (MARKETPLACE_KEYS.some((k) => t.startsWith(`# ${k}`))) return true
  if (t.startsWith('# Discord marketplace wallets')) return true
  if (t.startsWith('# Discord shop (/owltopia-shop)')) return true
  if (t.includes('dedicated marketplace wallets (migration 190')) return true
  if (t.includes('Generate locally: npm run generate:discord-marketplace-wallets')) return true
  if (t.includes('ESCROW: inventory (NFTs + OWL stock)')) return true
  if (t.includes('Use NEW keys — not prize escrow')) return true
  if (t.includes('OWL treasury for points-shop auto-delivery')) return true
  if (t.includes('Vercel: add the four vars above')) return true
  if (t.includes('Do NOT add NEXT_PUBLIC_ prefix to secret keys')) return true
  if (t === '# Admin UI: /admin/discord-shop — unified deposit + pricing flow.') return true
  if (t === '# Admin UI: /admin/discord-shop') return true
  if (t.includes('Escrow: NFT + OWL inventory. Payment: buyer SOL/OWL')) return true
  return false
}

function mergeEnvLocal(content, blockLines) {
  const lines = content.split('\n')
  const filtered = lines.filter((line) => !isMarketplaceLine(line))

  let insertAt = filtered.findIndex((l) => l.includes('DISCORD_PARTNER_PAYMENT_INTENT_TTL_HOURS'))
  if (insertAt >= 0) {
    insertAt += 1
  } else {
    insertAt = filtered.findIndex((l) => l.includes('DISCORD_BOT_TOKEN') || l.includes('DISCORD_GUILD_ID'))
    if (insertAt >= 0) {
      while (insertAt < filtered.length && filtered[insertAt]?.trim() !== '') insertAt++
    } else {
      insertAt = filtered.length
    }
  }

  const before = filtered.slice(0, insertAt)
  const after = filtered.slice(insertAt)
  while (before.length > 0 && before[before.length - 1]?.trim() === '') before.pop()
  while (after.length > 0 && after[0]?.trim() === '') after.shift()

  return [...before, '', ...blockLines, '', ...after].join('\n').replace(/\n{3,}/g, '\n\n')
}

if (!existsSync(SECRETS_FILE)) {
  console.error('Missing', SECRETS_FILE)
  console.error('Run: npm run generate:discord-marketplace-wallets')
  process.exit(1)
}

const secrets = JSON.parse(readFileSync(SECRETS_FILE, 'utf8'))
const blockLines = buildEnvBlock(secrets)
const existing = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, 'utf8') : ''
const merged = mergeEnvLocal(existing, blockLines)

writeFileSync(ENV_LOCAL, merged.endsWith('\n') ? merged : merged + '\n', { mode: 0o600 })

console.log('Merged Discord marketplace vars into', ENV_LOCAL)
console.log('Escrow:   ', secrets.wallets.escrow.publicKey)
console.log('Payment:  ', secrets.wallets.payment.publicKey)
console.log('Treasury: ', secrets.wallets.owlTreasury.publicKey)
