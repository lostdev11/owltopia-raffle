/**
 * Ops check: confirm partner public_simple wallet limits stack (migration 243).
 *
 * Run with env: npx --yes tsx --env-file=.env.local scripts/inspect-public-simple-wallet-limit-stacking.ts
 *
 * Does not mutate wallet_mint_limit — resetting public 7→5 is a live ops decision.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const key =
  process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!url || !key) {
  console.log(
    'skip: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY/SERVICE_ROLE_KEY not set — cannot verify prod DB from this environment.'
  )
  console.log(
    'Migration 243 (public_simple wallet limit excludes allowlist) ships in-repo; stacking unit tests cover the subtract helper.'
  )
  process.exit(0)
}

const db = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  const { data, error } = await db.rpc('confirm_owl_center_gen2_mint', {
    p_launch_slug: '__stacking_probe_missing__',
    p_wallet: '11111111111111111111111111111111',
    p_tx_signature: 'probe',
    p_quantity: 1,
    p_phase: 'PUBLIC',
    p_minted_nft_mints: [],
  })
  // Expect launch_not_found (function exists). Missing function → PostgREST error.
  if (error && /could not find|schema cache|does not exist/i.test(error.message)) {
    console.error('FAIL: confirm_owl_center_gen2_mint missing — apply migration 243')
    console.error(error.message)
    process.exit(1)
  }
  console.log('ok: confirm_owl_center_gen2_mint callable', data ?? error?.message ?? '')

  const { data: launches, error: launchErr } = await db
    .from('owl_center_launches')
    .select('slug, wallet_mint_limit, partner_allowlist_phases, mint_mode')
    .eq('mint_mode', 'public_simple')
    .order('updated_at', { ascending: false })
    .limit(10)
  if (launchErr) {
    console.error('launch list error', launchErr.message)
    process.exit(1)
  }
  for (const row of launches ?? []) {
    const phases = Array.isArray(row.partner_allowlist_phases) ? row.partner_allowlist_phases : []
    const wlLimits = phases
      .map((p: { key?: string; wallet_mint_limit?: number | null }) => `${p.key}=${p.wallet_mint_limit ?? 'inherit'}`)
      .join(', ')
    console.log(
      `launch ${row.slug}: public wallet_mint_limit=${row.wallet_mint_limit}` +
        (wlLimits ? ` · allowlist [${wlLimits}]` : '')
    )
  }
  console.log(
    'Note: if a live drop still has public=7 as a cumulative workaround, reset to 5 only after confirming stacking is live and product intent is 5 public-phase mints.'
  )
}

void main()
