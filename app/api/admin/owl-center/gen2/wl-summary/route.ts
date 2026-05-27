import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { GEN2_WL_COLLAB_COMMUNITIES } from '@/lib/owl-center/phase-display'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const launch = await getOwlCenterLaunchBySlug('gen2')
  if (!launch) {
    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })
  }

  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_center_wl_allocations').select('wallet,allowed_mints,used_mints,community')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = data ?? []
  let total_allowed = 0
  let total_used = 0
  const by_community: Record<string, { wallets: number; allowed: number; used: number }> = {}

  for (const r of rows) {
    const row = r as { allowed_mints?: number; used_mints?: number; community?: string | null }
    const allowed = Number(row.allowed_mints ?? 0)
    const used = Number(row.used_mints ?? 0)
    total_allowed += allowed
    total_used += used
    const key = row.community?.trim() || 'unassigned'
    if (!by_community[key]) by_community[key] = { wallets: 0, allowed: 0, used: 0 }
    by_community[key].wallets += 1
    by_community[key].allowed += allowed
    by_community[key].used += used
  }

  const wl_cap = launch.wl_supply
  const over_allocated_by = Math.max(0, total_allowed - wl_cap)

  return NextResponse.json({
    wl_cap,
    wallet_count: rows.length,
    total_allowed,
    total_used,
    total_available: Math.max(0, total_allowed - total_used),
    over_allocated_by,
    by_community,
    collab_communities: GEN2_WL_COLLAB_COMMUNITIES,
  })
}
