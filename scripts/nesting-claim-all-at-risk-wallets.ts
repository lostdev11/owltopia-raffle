/**
 * List wallets likely to hit Claim-all lock/RPC issues (many active nests, ghost rows, ledger drift).
 * Usage: npx --yes tsx scripts/nesting-claim-all-at-risk-wallets.ts [--min-active=10]
 */
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'

loadEnvConfig(process.cwd())

const minActive = (() => {
  const arg = process.argv.find((a) => a.startsWith('--min-active='))
  if (!arg) return 10
  const n = Number(arg.slice('--min-active='.length))
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 10
})()

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Row = {
  wallet_address: string
  active_nests: number
  ghost_active: number
  self_catchup_adj: number
  onchain_claims: number
  onchain_claim_owl: number
}

async function main() {
  const { data: positions, error: posErr } = await db
    .from('staking_positions')
    .select('wallet_address, status, asset_identifier')
  if (posErr) throw new Error(posErr.message)

  const { data: events, error: evErr } = await db
    .from('staking_reward_events')
    .select('wallet_address, event_type, note, amount, transaction_signature')
  if (evErr) throw new Error(evErr.message)

  const byWallet = new Map<string, Row>()

  for (const p of positions ?? []) {
    const w = String(p.wallet_address).trim()
    if (!w) continue
    let row = byWallet.get(w)
    if (!row) {
      row = {
        wallet_address: w,
        active_nests: 0,
        ghost_active: 0,
        self_catchup_adj: 0,
        onchain_claims: 0,
        onchain_claim_owl: 0,
      }
      byWallet.set(w, row)
    }
    if (p.status === 'active') {
      row.active_nests += 1
      const asset = typeof p.asset_identifier === 'string' ? p.asset_identifier.trim() : ''
      if (!asset) row.ghost_active += 1
    }
  }

  for (const e of events ?? []) {
    const w = String(e.wallet_address).trim()
    if (!w) continue
    let row = byWallet.get(w)
    if (!row) continue
    if (
      e.event_type === 'adjustment' &&
      e.note === 'holder_self_catchup_after_ledger_sync_failure'
    ) {
      row.self_catchup_adj += 1
    }
    if (e.event_type === 'claim' && e.transaction_signature) {
      row.onchain_claims += 1
      row.onchain_claim_owl += Number(e.amount) || 0
    }
  }

  const atRisk = [...byWallet.values()]
    .filter((r) => r.active_nests >= minActive || r.ghost_active > 0)
    .sort((a, b) => b.active_nests - a.active_nests || b.ghost_active - a.ghost_active)

  console.log(
    JSON.stringify(
      {
        min_active_threshold: minActive,
        wallet_count: atRisk.length,
        wallets: atRisk,
      },
      null,
      2
    )
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
