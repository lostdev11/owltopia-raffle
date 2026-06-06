import { NextRequest, NextResponse } from 'next/server'

import { listWlAllocations, listWlAllocationsByCommunity } from '@/lib/db/owl-center-wl-allocations'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'

export const dynamic = 'force-dynamic'

/** GET — list WL allocations, optionally filtered by community slug (use `unassigned` for untagged). */
export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const community = request.nextUrl.searchParams.get('community')?.trim()
    const limitRaw = request.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : 500

    const rows = community
      ? await listWlAllocationsByCommunity(community, limit)
      : await listWlAllocations(limit)

    const total_allowed = rows.reduce((sum, r) => sum + r.allowed_mints, 0)
    const total_used = rows.reduce((sum, r) => sum + r.used_mints, 0)

    return NextResponse.json({
      community: community ?? null,
      wallet_count: rows.length,
      total_allowed,
      total_used,
      rows,
    })
  } catch (e) {
    console.error('[admin/wl-allocations GET]', e)
    return NextResponse.json({ error: 'Failed to load WL allocations' }, { status: 500 })
  }
}
