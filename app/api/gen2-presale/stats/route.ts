import { NextRequest, NextResponse } from 'next/server'

import { buildGen2PresalePublicStats } from '@/lib/gen2-presale/public-stats'
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

    const payload: Gen2PresaleStats = await buildGen2PresalePublicStats()

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
