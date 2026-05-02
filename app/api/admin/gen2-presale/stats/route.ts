import { NextRequest, NextResponse } from 'next/server'

import { getGen2PresalePublicOffer } from '@/lib/gen2-presale/config'
import { sumConfirmedPresaleSold } from '@/lib/gen2-presale/db'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getGen2PresaleSettings } from '@/lib/db/gen2-presale-settings'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const offer = getGen2PresalePublicOffer()
    const [sold, settings] = await Promise.all([sumConfirmedPresaleSold(), getGen2PresaleSettings()])
    const presale_supply = offer.presaleSupply
    const remaining = Math.max(0, presale_supply - sold)
    const percent_sold = presale_supply > 0 ? (sold / presale_supply) * 100 : 0

    return NextResponse.json({
      presale_supply,
      sold,
      remaining,
      percent_sold,
      unit_price_usdc: offer.priceUsdc,
      presale_live: settings.is_live,
      presale_settings_updated_at: settings.updated_at,
      presale_settings_updated_by: settings.updated_by_wallet,
    })
  } catch (error) {
    console.error('admin gen2-presale stats:', error)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
