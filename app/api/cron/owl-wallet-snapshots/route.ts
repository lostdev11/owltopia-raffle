import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { OWL_PROPOSAL_SNAPSHOT_TTL_MS } from '@/lib/council/owl-balance-credit-aware'
import { getOrRefreshOwlProposalEligibility } from '@/lib/council/owl-snapshot-eligibility'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BATCH = 250

/**
 * GET /api/cron/owl-wallet-snapshots
 * Weekly cron: refresh OWL snapshots that are past TTL (and seed admins). Bearer CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('CRON_SECRET is not set')
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'server error' }, { status: 401 })
  }

  try {
    const cutoff = new Date(Date.now() - OWL_PROPOSAL_SNAPSHOT_TTL_MS).toISOString()
    const admin = getSupabaseAdmin()

    const staleRes = await admin
      .from('owl_wallet_owl_snapshots')
      .select('wallet_address')
      .lt('checked_at', cutoff)
      .limit(BATCH)

    const staleRows = staleRes.data ?? []
    const adminRes = await admin.from('admins').select('wallet_address').limit(BATCH)

    const wallets = new Set<string>()
    for (const r of staleRows) {
      const w = (r as { wallet_address?: string }).wallet_address?.trim()
      if (w) wallets.add(w)
    }
    for (const r of adminRes.data ?? []) {
      const w = (r as { wallet_address?: string }).wallet_address?.trim()
      if (w) wallets.add(w)
    }

    const list = [...wallets].slice(0, BATCH)
    let refreshed = 0
    let errors = 0

    for (const w of list) {
      const res = await getOrRefreshOwlProposalEligibility(w)
      if (res.ok && res.refreshed) refreshed += 1
      if (!res.ok) errors += 1
    }

    return NextResponse.json({
      ok: true,
      processedWallets: list.length,
      refreshedApprox: refreshed,
      errorsApprox: errors,
    })
  } catch (error) {
    console.error('[cron/owl-wallet-snapshots]', error)
    return NextResponse.json({ error: 'cron failed' }, { status: 500 })
  }
}
