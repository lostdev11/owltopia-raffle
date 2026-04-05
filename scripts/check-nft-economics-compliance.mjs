/**
 * Read-only: NFT economics — min_tickets should equal round(floor ÷ ticket_price).
 * Run: node --env-file=.env.local scripts/check-nft-economics-compliance.mjs
 */
import { createClient } from '@supabase/supabase-js'

function parseNftFloorPrice(raw) {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return { ok: false }
  const s = String(raw).trim()
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0) return { ok: false }
  return { ok: true, value: n }
}

function parseNftTicketPrice(raw) {
  if (raw == null || raw === '') return { ok: false }
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).trim())
  if (!Number.isFinite(n) || n <= 0) return { ok: false }
  return { ok: true, value: n }
}

function computeMin(floor, ticket) {
  return Math.max(1, Math.round(floor / ticket))
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

const { data: raffles, error } = await supabase
  .from('raffles')
  .select(
    'id, slug, status, prize_type, floor_price, ticket_price, min_tickets, max_tickets, prize_amount, prize_currency'
  )
  .eq('prize_type', 'nft')

if (error) {
  console.error(error)
  process.exit(1)
}

const list = raffles ?? []
const minMismatch = []
const maxBelowMin = []
const badFloor = []
const prizeAmount = []
const strayCurrency = []

for (const r of list) {
  const fp = parseNftFloorPrice(r.floor_price)
  const tp = parseNftTicketPrice(r.ticket_price)
  if (!fp.ok || !tp.ok) {
    badFloor.push(r)
    continue
  }
  const expected = computeMin(fp.value, tp.value)
  const curMin = r.min_tickets != null ? Number(r.min_tickets) : NaN
  if (!Number.isFinite(curMin) || curMin !== expected) {
    minMismatch.push({ slug: r.slug, stored: r.min_tickets, expected })
  }
  const curMax = r.max_tickets != null ? Number(r.max_tickets) : null
  if (curMax != null && Number.isFinite(curMax) && curMax < expected) {
    maxBelowMin.push({ slug: r.slug, max: r.max_tickets, minGoal: expected })
  }
  const pa = r.prize_amount != null ? Number(r.prize_amount) : null
  if (pa != null && Number.isFinite(pa) && pa > 0) {
    prizeAmount.push(r.slug)
  }
  if (r.prize_currency != null && String(r.prize_currency).trim() !== '') {
    strayCurrency.push(r.slug)
  }
}

console.log('\n=== NFT economics check (read-only) ===\n')
console.log(`Total NFT raffles: ${list.length}`)
console.log(
  'Optional: list migration 050 constraints in Supabase SQL Editor — if present, run migration 051 to drop fixed-50 checks.\n'
)

console.log('min_tickets ≠ round(floor ÷ ticket_price):')
if (minMismatch.length === 0) console.log('  None.')
else minMismatch.forEach((x) => console.log(`  ${x.slug} | stored=${x.stored} expected=${x.expected}`))

console.log('\nmax_tickets < draw goal:')
if (maxBelowMin.length === 0) console.log('  None.')
else maxBelowMin.forEach((x) => console.log(`  ${x.slug} | max=${x.max} goal=${x.minGoal}`))

console.log('\nInvalid floor or ticket:')
if (badFloor.length === 0) console.log('  None.')
else badFloor.forEach((r) => console.log(`  ${r.slug}`))

console.log('\nprize_amount > 0 (NFT should use floor only):')
if (prizeAmount.length === 0) console.log('  None.')
else prizeAmount.forEach((s) => console.log(`  ${s}`))

console.log('\nnon-empty prize_currency:')
if (strayCurrency.length === 0) console.log('  None.')
else strayCurrency.forEach((s) => console.log(`  ${s}`))

console.log('\nFix: pnpm run normalize:nft-economics (dry-run) then apply with safeguards.\n')
process.exit(0)
