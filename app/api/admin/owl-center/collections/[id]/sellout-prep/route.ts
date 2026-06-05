import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { runSelloutMarketplacePrep } from '@/lib/owl-center/sellout-marketplace-prep'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Manually run sell-out marketplace prep (hash list + ME/Tensor URLs). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const { id } = await context.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid collection id' }, { status: 400 })
  }

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })

  const result = await runSelloutMarketplacePrep(launch)
  return NextResponse.json({ ok: result.ok, result, launch })
}
