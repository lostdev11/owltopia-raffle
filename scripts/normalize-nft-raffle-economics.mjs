/**
 * One-off: align legacy NFT raffles with server rules (fixed min_tickets=50, ticket=floor/50,
 * clear prize_amount, fix max_tickets < 50).
 *
 * Default: dry-run (prints planned changes only).
 *
 * Apply (two safeguards — both required):
 *   1) Environment: ALLOW_NFT_ECONOMICS_NORMALIZE=1 for this process only (do not leave in .env).
 *   2) Flag: --confirm-apply
 *
 * Example (PowerShell):
 *   $env:ALLOW_NFT_ECONOMICS_NORMALIZE='1'
 *   node --env-file=.env.local scripts/normalize-nft-raffle-economics.mjs --apply --confirm-apply
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'

const NFT_RAFFLE_MIN_TICKETS = 50

function parseNftFloorPrice(raw) {
  if (raw == null || (typeof raw === 'string' && !raw.trim())) {
    return { ok: false }
  }
  const s = String(raw).trim()
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0 || n > 1e15) {
    return { ok: false }
  }
  return { ok: true, value: n, string: s }
}

function computeNftTicketPriceFromFloor(floor) {
  const raw = floor / NFT_RAFFLE_MIN_TICKETS
  return Math.round(raw * 1e9) / 1e9
}

function ticketMatches(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  return Math.abs(a - b) <= 1e-8
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const apply = process.argv.includes('--apply')
const confirmApply = process.argv.includes('--confirm-apply')

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

if (apply) {
  if (process.env.ALLOW_NFT_ECONOMICS_NORMALIZE !== '1') {
    console.error(
      'Refusing --apply: set ALLOW_NFT_ECONOMICS_NORMALIZE=1 in the environment for this command only.\n' +
        'Do not commit that variable to shared .env files.'
    )
    process.exit(1)
  }
  if (!confirmApply) {
    console.error(
      'Refusing --apply: also pass --confirm-apply after reviewing dry-run output.\n' +
        'Example: ALLOW_NFT_ECONOMICS_NORMALIZE=1 node ... --apply --confirm-apply'
    )
    process.exit(1)
  }
}

const supabase = createClient(url, key)

const { data: raffles, error: rafflesError } = await supabase
  .from('raffles')
  .select(
    'id, slug, status, prize_type, floor_price, ticket_price, min_tickets, max_tickets, prize_amount, prize_currency, edited_after_entries'
  )
  .eq('prize_type', 'nft')

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
let toFix = []

for (const r of raffles ?? []) {
  const fp = parseNftFloorPrice(r.floor_price)
  if (!fp.ok) {
    skippedNoFloor++
    console.warn(`SKIP (no valid floor_price): ${r.slug} id=${r.id} status=${r.status}`)
    continue
  }

  const expectedTicket = computeNftTicketPriceFromFloor(fp.value)
  const curMin = r.min_tickets != null ? Number(r.min_tickets) : NaN
  const curTicket = r.ticket_price != null ? Number(r.ticket_price) : NaN
  const curMax = r.max_tickets != null ? Number(r.max_tickets) : null
  const prizeAmt = r.prize_amount != null ? Number(r.prize_amount) : null

  let maxOut = curMax
  if (curMax != null && Number.isFinite(curMax) && curMax < NFT_RAFFLE_MIN_TICKETS) {
    maxOut = null
  }

  const needsMin = !Number.isFinite(curMin) || curMin !== NFT_RAFFLE_MIN_TICKETS
  const needsTicket = !ticketMatches(curTicket, expectedTicket)
  const needsPrize = prizeAmt != null && Number.isFinite(prizeAmt) && prizeAmt > 0
  const needsMaxFix = curMax != null && Number.isFinite(curMax) && curMax < NFT_RAFFLE_MIN_TICKETS
  const needsPrizeCurrency = r.prize_currency != null && String(r.prize_currency).trim() !== ''

  if (!needsMin && !needsTicket && !needsPrize && !needsMaxFix && !needsPrizeCurrency) {
    alreadyOk++
    continue
  }

  toFix.push({
    row: r,
    fp,
    expectedTicket,
    maxOut,
    needsMin,
    needsTicket,
    needsPrize,
    needsMaxFix,
    needsPrizeCurrency,
  })
}

console.log(
  `\nNFT raffles: ${(raffles ?? []).length} total | already aligned: ${alreadyOk} | need update: ${toFix.length} | skipped (bad floor): ${skippedNoFloor}`
)
console.log(apply ? 'MODE: APPLY (writing to database)\n' : 'MODE: DRY-RUN (no writes). Pass --apply to execute.\n')

for (const item of toFix) {
  const { row, fp, expectedTicket, maxOut } = item
  const patch = {
    min_tickets: NFT_RAFFLE_MIN_TICKETS,
    ticket_price: expectedTicket,
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
    `    min_tickets: ${row.min_tickets} → ${patch.min_tickets} | ticket_price: ${row.ticket_price} → ${patch.ticket_price} | floor_price: ${row.floor_price} → ${patch.floor_price}`
  )
  if (item.needsMaxFix) {
    console.log(`    max_tickets: ${row.max_tickets} → ${patch.max_tickets} (was below ${NFT_RAFFLE_MIN_TICKETS}; set unlimited)`)
  }
  if (item.needsPrize || item.needsPrizeCurrency) {
    console.log(`    prize_amount/prize_currency cleared (NFT uses floor only)`)
  }
  if (patch.edited_after_entries) {
    console.log(`    edited_after_entries → true (confirmed entries exist)`)
  }

  if (apply) {
    const { error } = await supabase.from('raffles').update(patch).eq('id', row.id)
    if (error) {
      console.error(`    ERROR: ${error.message}`)
    } else {
      console.log(`    OK`)
    }
  }
}

if (!apply && toFix.length > 0) {
  console.log(`\nRun with --apply to write ${toFix.length} update(s).`)
}

process.exit(0)
