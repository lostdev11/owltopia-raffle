/**
 * One-off: align NFT raffles with current rules — min_tickets = round(floor ÷ ticket_price),
 * clear prize_amount on NFT, fix max_tickets < min_tickets.
 *
 * **Default scope: status = draft only.** Product rule: new economics apply to new raffles at
 * creation; live / ended rows must not be bulk-rewritten by this script. Use explicit SQL per
 * raffle if a live listing needs a manual fix.
 *
 * To include non-draft NFT raffles (dangerous): pass --include-non-draft plus
 * ALLOW_NFT_ECONOMICS_NORMALIZE_NON_DRAFT=1 and --confirm-non-draft (in addition to apply flags).
 *
 * Default: dry-run. Apply requires ALLOW_NFT_ECONOMICS_NORMALIZE=1 and --apply --confirm-apply
 *
 * Run: node --env-file=.env.local scripts/normalize-nft-raffle-economics.mjs
 */
import { createClient } from '@supabase/supabase-js'

function parseNftFloorPrice(raw) {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return { ok: false }
  const s = String(raw).trim()
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0 || n > 1e15) return { ok: false }
  return { ok: true, value: n, string: s }
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
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const apply = process.argv.includes('--apply')
const confirmApply = process.argv.includes('--confirm-apply')
const includeNonDraft = process.argv.includes('--include-non-draft')
const confirmNonDraft = process.argv.includes('--confirm-non-draft')

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (includeNonDraft) {
  if (process.env.ALLOW_NFT_ECONOMICS_NORMALIZE_NON_DRAFT !== '1') {
    console.error(
      'Refusing --include-non-draft: set ALLOW_NFT_ECONOMICS_NORMALIZE_NON_DRAFT=1 for this command only.'
    )
    process.exit(1)
  }
  if (!confirmNonDraft) {
    console.error(
      'Refusing --include-non-draft: also pass --confirm-non-draft after reviewing impact on live/ended raffles.'
    )
    process.exit(1)
  }
}

if (apply) {
  if (process.env.ALLOW_NFT_ECONOMICS_NORMALIZE !== '1') {
    console.error(
      'Refusing --apply: set ALLOW_NFT_ECONOMICS_NORMALIZE=1 in the environment for this command only.'
    )
    process.exit(1)
  }
  if (!confirmApply) {
    console.error('Refusing --apply: also pass --confirm-apply after reviewing dry-run output.')
    process.exit(1)
  }
}

const supabase = createClient(url, key)

let raffleQuery = supabase
  .from('raffles')
  .select(
    'id, slug, status, prize_type, floor_price, ticket_price, min_tickets, max_tickets, prize_amount, prize_currency, edited_after_entries'
  )
  .eq('prize_type', 'nft')

if (!includeNonDraft) {
  raffleQuery = raffleQuery.eq('status', 'draft')
}

const { data: raffles, error: rafflesError } = await raffleQuery

if (rafflesError) {
  console.error(rafflesError)
  process.exit(1)
}

const { data: entryRows, error: entriesError } = await supabase
  .from('entries')
  .select('raffle_id')
  .eq('status', 'confirmed')

if (entriesError) {
  console.error(entriesError)
  process.exit(1)
}

const rafflesWithConfirmedEntries = new Set((entryRows ?? []).map((r) => r.raffle_id))

let skippedNoFloor = 0
let alreadyOk = 0
const toFix = []

for (const r of raffles ?? []) {
  const fp = parseNftFloorPrice(r.floor_price)
  const tp = parseNftTicketPrice(r.ticket_price)
  if (!fp.ok || !tp.ok) {
    skippedNoFloor++
    console.warn(`SKIP (need valid floor_price + ticket_price): ${r.slug} id=${r.id}`)
    continue
  }

  const expectedMin = computeMin(fp.value, tp.value)
  const curMin = r.min_tickets != null ? Number(r.min_tickets) : NaN
  const curMax = r.max_tickets != null ? Number(r.max_tickets) : null
  const prizeAmt = r.prize_amount != null ? Number(r.prize_amount) : null

  let maxOut = curMax
  if (curMax != null && Number.isFinite(curMax) && Number.isFinite(expectedMin) && curMax < expectedMin) {
    maxOut = null
  }

  const needsMin = !Number.isFinite(curMin) || curMin !== expectedMin
  const needsPrize = prizeAmt != null && Number.isFinite(prizeAmt) && prizeAmt > 0
  const needsMaxFix =
    curMax != null && Number.isFinite(curMax) && Number.isFinite(expectedMin) && curMax < expectedMin
  const needsPrizeCurrency = r.prize_currency != null && String(r.prize_currency).trim() !== ''

  if (!needsMin && !needsPrize && !needsMaxFix && !needsPrizeCurrency) {
    alreadyOk++
    continue
  }

  toFix.push({ row: r, fp, tp, expectedMin, maxOut, needsMaxFix })
}

console.log(
  `\nSCOPE: ${includeNonDraft ? 'ALL NFT statuses (non-draft included)' : 'draft NFT only'}\n` +
    `NFT raffles in scope: ${(raffles ?? []).length} | aligned: ${alreadyOk} | need update: ${toFix.length} | skipped: ${skippedNoFloor}`
)
console.log(apply ? 'MODE: APPLY\n' : 'MODE: DRY-RUN. Use --apply --confirm-apply with ALLOW_NFT_ECONOMICS_NORMALIZE=1\n')

for (const item of toFix) {
  const { row, fp, tp, expectedMin, maxOut } = item
  const patch = {
    min_tickets: expectedMin,
    ticket_price: tp.value,
    floor_price: fp.string,
    prize_amount: null,
    prize_currency: null,
    max_tickets: maxOut,
  }

  if (rafflesWithConfirmedEntries.has(row.id)) {
    patch.edited_after_entries = true
  }

  console.log(`- ${row.slug} (${row.status})`)
  console.log(
    `    min_tickets: ${row.min_tickets} → ${patch.min_tickets} | ticket=${row.ticket_price} floor=${row.floor_price}`
  )
  if (item.needsMaxFix) {
    console.log(`    max_tickets: ${row.max_tickets} → ${patch.max_tickets} (was below draw goal)`)
  }
  if (patch.edited_after_entries) console.log(`    edited_after_entries → true`)

  if (apply) {
    const { error } = await supabase.from('raffles').update(patch).eq('id', row.id)
    if (error) console.error(`    ERROR: ${error.message}`)
    else console.log(`    OK`)
  }
}

if (!apply && toFix.length > 0) {
  console.log(`\nRun with --apply --confirm-apply to write ${toFix.length} update(s).`)
}

process.exit(0)
