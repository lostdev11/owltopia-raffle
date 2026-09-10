/**
 * Lightweight checks for partner name matching + merge helpers (no DB).
 * Run: node scripts/check-partner-retire-path.mjs
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function normalizePartnerMatchKey(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

function partnerNameMatchesQuery(query, candidates) {
  const q = normalizePartnerMatchKey(query)
  if (!q || q.length < 2) return false
  for (const c of candidates) {
    const n = normalizePartnerMatchKey(c)
    if (!n) continue
    if (n === q || n.includes(q) || q.includes(n)) return true
  }
  return false
}

assert.equal(normalizePartnerMatchKey('Shonen Sol'), 'shonensol')
assert.equal(normalizePartnerMatchKey('Gearheadcoins'), 'gearheadcoins')
assert.ok(partnerNameMatchesQuery('ShonenSol', ['Shonen Sol', 'shonen']))
assert.ok(partnerNameMatchesQuery('eapes', ['Eapes partner logo', 'eapes']))
assert.ok(partnerNameMatchesQuery('goofy giraffes', ['Goofy Giraffes']))
assert.ok(!partnerNameMatchesQuery('x', ['SharkyFi']))

// Parse partner-logos.ts for removed brands + PARTNER_SPOTLIGHT_BRANDS entries
const src = readFileSync(new URL('../lib/partner-logos.ts', import.meta.url), 'utf8')
const blob = src.toLowerCase()
assert.ok(!blob.includes('gearhead'))
assert.ok(!/\bshonen\b/.test(blob))
assert.ok(!blob.includes('eapes'))

const block = src.match(/export const PARTNER_SPOTLIGHT_BRANDS: PartnerLogo\[\] = \[([\s\S]*?)\]\n/)
assert.ok(block, 'PARTNER_SPOTLIGHT_BRANDS block missing')
assert.ok(block[1].includes('LOGO_ASSETS.sharkyfi'))
assert.ok(!block[1].includes('gearhead'))

// Confirm retire slash + migration exist
const slash = readFileSync(new URL('../lib/discord-slash-command-definitions.ts', import.meta.url), 'utf8')
assert.ok(slash.includes("name: 'retire'"))
const handle = readFileSync(new URL('../lib/discord-handle-interaction.ts', import.meta.url), 'utf8')
assert.ok(handle.includes("sub === 'retire'"))
assert.ok(handle.includes('retirePartnerCommunity'))
const mig = readFileSync(
  new URL('../supabase/migrations/237_partner_spotlight_brands.sql', import.meta.url),
  'utf8'
)
assert.ok(mig.includes('CREATE TABLE IF NOT EXISTS partner_spotlight_brands'))
const adminDiscord = readFileSync(
  new URL('../app/api/admin/discord-giveaway-partners/[id]/route.ts', import.meta.url),
  'utf8'
)
assert.ok(adminDiscord.includes("patch.status === 'suspended'"))
assert.ok(adminDiscord.includes('retirePartnerCommunity'))

console.log('check-partner-retire-path: ok')
