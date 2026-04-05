/**
 * Read-only: report NFT raffle rows vs migration 050 rules + normalize script rules.
 * Does not modify the database.
 *
 * Run: node --env-file=.env.local scripts/check-nft-economics-compliance.mjs
 *
 * For "is migration 050 applied?" use scripts/check-nft-economics-compliance.sql in Supabase SQL Editor.
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

const dbRuleViolations = []
const ticketDrift = []
const badFloor = []
const strayPrizeCurrency = []

for (const r of list) {
  const curMin = r.min_tickets != null ? Number(r.min_tickets) : NaN
  const curMax = r.max_tickets != null ? Number(r.max_tickets) : null
  const prizeAmt = r.prize_amount != null ? Number(r.prize_amount) : null

  if (!Number.isFinite(curMin) || curMin !== NFT_RAFFLE_MIN_TICKETS) {
    dbRuleViolations.push({ r, reason: `min_tickets=${r.min_tickets} (expected ${NFT_RAFFLE_MIN_TICKETS})` })
  }
  if (curMax != null && Number.isFinite(curMax) && curMax < NFT_RAFFLE_MIN_TICKETS) {
    dbRuleViolations.push({ r, reason: `max_tickets=${r.max_tickets} (< ${NFT_RAFFLE_MIN_TICKETS})` })
  }
  if (prizeAmt != null && Number.isFinite(prizeAmt) && prizeAmt > 0) {
    dbRuleViolations.push({ r, reason: `prize_amount=${r.prize_amount} (expected null for NFT)` })
  }

  const fp = parseNftFloorPrice(r.floor_price)
  if (!fp.ok) {
    badFloor.push(r)
  } else {
    const expected = computeNftTicketPriceFromFloor(fp.value)
    const curTicket = r.ticket_price != null ? Number(r.ticket_price) : NaN
    if (!ticketMatches(curTicket, expected)) {
      ticketDrift.push({
        slug: r.slug,
        floor: r.floor_price,
        ticket_price: r.ticket_price,
        expected_ticket: expected,
      })
    }
  }

  if (r.prize_currency != null && String(r.prize_currency).trim() !== '') {
    strayPrizeCurrency.push({ slug: r.slug, prize_currency: r.prize_currency })
  }
}

console.log('\n=== NFT raffle economics compliance (read-only) ===\n')
console.log(`Total NFT raffles: ${list.length}`)
console.log(
  '\nMigration 050 (DB CHECKs): cannot be verified from this script. Run the SQL file in Supabase:'
)
console.log('  scripts/check-nft-economics-compliance.sql\n')

console.log('--- Rows violating migration 050 rules (min=50, max null or >=50, prize_amount null) ---')
if (dbRuleViolations.length === 0) {
  console.log('None. If migration 050 is applied, the database matches those rules.')
} else {
  for (const { r, reason } of dbRuleViolations) {
    console.log(`  ${r.slug} | ${reason}`)
  }
}

console.log('\n--- Rows with invalid / missing floor_price (fix manually) ---')
if (badFloor.length === 0) {
  console.log('None.')
} else {
  for (const r of badFloor) {
    console.log(`  ${r.slug} | floor_price=${JSON.stringify(r.floor_price)}`)
  }
}

console.log('\n--- Rows where ticket_price ≠ floor÷50 (normalize script fixes this; not a DB CHECK) ---')
if (ticketDrift.length === 0) {
  console.log('None.')
} else {
  for (const x of ticketDrift) {
    console.log(
      `  ${x.slug} | ticket=${x.ticket_price} expected≈${x.expected_ticket} | floor=${x.floor}`
    )
  }
}

console.log('\n--- Rows with non-empty prize_currency (normalize clears; not in migration 050 alone) ---')
if (strayPrizeCurrency.length === 0) {
  console.log('None.')
} else {
  for (const x of strayPrizeCurrency) {
    console.log(`  ${x.slug} | prize_currency=${x.prize_currency}`)
  }
}

console.log('\n--- What to do ---')
if (dbRuleViolations.length > 0) {
  console.log(
    '- If migration 050 never ran: run normalize (apply), then apply migration 050.\n' +
      '- If 050 already ran but violations show here, something is inconsistent — investigate before changing data.'
  )
} else if (ticketDrift.length > 0 || strayPrizeCurrency.length > 0) {
  console.log(
    '- DB rules OK. Optional: run normalize script (dry-run then apply) to align ticket_price and prize_currency.'
  )
} else {
  console.log('- No issues reported by this check.')
}

console.log('')
process.exit(0)
