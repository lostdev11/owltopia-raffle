import { NextRequest, NextResponse } from 'next/server'

import { getGen2PresalePublicOffer } from '@/lib/gen2-presale/config'
import { sumConfirmedPresaleSold } from '@/lib/gen2-presale/db'
import { getGen2PresaleSettings } from '@/lib/db/gen2-presale-settings'
import { getOptionalUnitLamportsQuote } from '@/lib/gen2-presale/pricing'
import { getGen2PresaleStatsIssues } from '@/lib/gen2-presale/presale-sanity'
import type { Gen2PresaleStats } from '@/lib/gen2-presale/types'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`gen2-stats:${ip}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const offer = getGen2PresalePublicOffer()

    const [sold, settings] = await Promise.all([sumConfirmedPresaleSold(), getGen2PresaleSettings()])
    const presale_supply = offer.presaleSupply
    const remaining = Math.max(0, presale_supply - sold)
    const percent_sold = presale_supply > 0 ? (sold / presale_supply) * 100 : 0

    const quote = await getOptionalUnitLamportsQuote()

    const payload: Gen2PresaleStats = {
      presale_supply,
      sold,
      remaining,
      percent_sold,
      unit_price_usdc: offer.priceUsdc,
      unit_lamports: quote ? quote.unitLamports.toString() : null,
      sol_usd_price: quote ? quote.solUsdPrice : null,
      presale_live: settings.is_live,
    }

    const sanityIssues = getGen2PresaleStatsIssues(payload)
    if (sanityIssues.length > 0) {
      console.warn('[gen2-presale/stats] sanity:', sanityIssues.join(' | '))
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('gen2-presale stats:', error)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
