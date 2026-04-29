/**
 * One-off: list raffles tied to "today" (UTC) and show time_extension_count.
 * Run: node --env-file=.env.local scripts/audit-min-threshold-extensions-today.mjs
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

function utcDayBounds() {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const day = `${y}-${m}-${d}`
  return {
    day,
    start: `${day}T00:00:00.000Z`,
    end: `${day}T23:59:59.999Z`,
  }
}

const { day, start, end } = utcDayBounds()
const nowIso = new Date().toISOString()

const { data: endedToday, error: e1 } = await supabase
  .from('raffles')
  .select(
    'id, slug, title, end_time, original_end_time, time_extension_count, status, is_active, min_tickets, winner_wallet, updated_at'
  )
  .gte('end_time', start)
  .lte('end_time', end)

const { data: updatedToday, error: e2 } = await supabase
  .from('raffles')
  .select(
    'id, slug, title, end_time, original_end_time, time_extension_count, status, is_active, min_tickets, winner_wallet, updated_at'
  )
  .gte('updated_at', start)
  .lte('updated_at', end)

if (e1 || e2) {
  console.error(e1 || e2)
  process.exit(1)
}

const byId = new Map()
for (const row of [...(endedToday ?? []), ...(updatedToday ?? [])]) {
  byId.set(row.id, row)
}

const rows = [...byId.values()].sort((a, b) =>
  String(a.slug).localeCompare(String(b.slug))
)

console.log(`UTC date: ${day} (now ${nowIso})`)
console.log(
  'Raffles with end_time on this UTC day OR updated_at on this UTC day (deduped).\n'
)
console.log(
  'time_extension_count: 0 = no min-threshold extension yet; >=1 = already extended (next miss → failed_refund_available with current policy).\n'
)

for (const r of rows) {
  const ext = r.time_extension_count ?? 0
  const phase =
    ext >= 2
      ? 'legacy: 2+ extensions recorded'
      : ext === 1
        ? 'extended once (next min miss → terminal)'
        : 'no extension yet'
  console.log(
    `- ${r.slug} | ext=${ext} → ${phase} | status=${r.status} | end=${r.end_time} | orig_end=${r.original_end_time ?? 'null'} | min_tickets=${r.min_tickets}`
  )
}

if (rows.length === 0) {
  console.log('(no rows matched)')
}
