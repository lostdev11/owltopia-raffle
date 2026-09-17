#!/usr/bin/env node
/**
 * Ops triage: look up a host wallet's pending claim-proceeds raffles.
 *
 * Usage (with .env.local / production env):
 *   npx --yes tsx --env-file=.env.local scripts/ops-funds-escrow-host-triage.ts 13mTkN2UbPv2RCZEU6LQYMjrXaoxbRKHZYFMYPMDbuPu
 *
 * Prints settlement amounts, funds_escrow_address_snapshot vs live FUNDS_ESCROW pubkey,
 * and whether a top-up or key restore is needed.
 */
import { createClient } from '@supabase/supabase-js'
import { getFundsEscrowPublicKey } from '../lib/raffles/funds-escrow'

async function main() {
  const wallet = (process.argv[2] || '').trim()
  if (!wallet) {
    console.error('Usage: ops-funds-escrow-host-triage.ts <creator_wallet>')
    process.exit(1)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !key || url.includes('placeholder')) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY — cannot query production from this environment.'
    )
    console.error(`Host wallet to triage: ${wallet}`)
    console.error(
      'Manual steps: find raffles where creator_wallet or created_by = wallet and status = successful_pending_claims;'
    )
    console.error(
      'compare funds_escrow_address_snapshot to live FUNDS_ESCROW; top up or restore key; retry claim.'
    )
    process.exit(2)
  }

  const db = createClient(url, key, { auth: { persistSession: false } })
  const live = getFundsEscrowPublicKey()

  const { data, error } = await db
    .from('raffles')
    .select(
      'id, slug, title, status, currency, creator_payout_amount, platform_fee_amount, creator_claimed_at, funds_escrow_address_snapshot, ticket_payments_to_funds_escrow, settled_at, creator_wallet, created_by'
    )
    .or(`creator_wallet.eq.${wallet},created_by.eq.${wallet}`)
    .order('settled_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Query failed:', error.message)
    process.exit(1)
  }

  const rows = data ?? []
  const pending = rows.filter(
    (r) =>
      String(r.status) === 'successful_pending_claims' &&
      !String(r.creator_claimed_at ?? '').trim()
  )

  console.log(
    JSON.stringify({ liveFundsEscrow: live, wallet, pendingCount: pending.length, pending }, null, 2)
  )

  for (const r of pending) {
    const snap = String(r.funds_escrow_address_snapshot ?? '').trim()
    const need = (Number(r.creator_payout_amount) || 0) + (Number(r.platform_fee_amount) || 0)
    console.log('\n---')
    console.log(`raffle ${r.id} (${r.slug})`)
    console.log(`need ${need} ${r.currency}`)
    console.log(`snapshot ${snap || '(none)'} vs live ${live || '(unset)'}`)
    if (snap && live && snap !== live) {
      console.log(
        'ACTION: key mismatch — move funds from snapshot → live, or restore snapshot secret'
      )
    } else {
      console.log(
        `ACTION: top up live funds escrow by at least ${need} ${r.currency} (+ fee buffer)`
      )
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
