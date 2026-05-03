import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getMarketplaceReadinessByLaunchId } from '@/lib/db/owl-center-marketplace'
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'

export const dynamic = 'force-dynamic'

/**
 * Admin-only: warn when trading is active but marketplace URLs are missing (no public clutter).
 */
export async function GET(request: NextRequest) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')
  if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })

  const mp = await getMarketplaceReadinessByLaunchId(launch.id)
  const tradingSignals =
    launch.status === 'TRADING_ACTIVE' ||
    launch.active_phase === 'TRADING_ACTIVE' ||
    Boolean(mp?.trading_links_active)

  const missingUrls = !launch.magic_eden_url?.trim() && !launch.tensor_url?.trim()

  return NextResponse.json({
    show_missing_links_warning: tradingSignals && missingUrls,
  })
}
