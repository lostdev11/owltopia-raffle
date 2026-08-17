import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'

import { listOwlCenterLaunchesAdmin } from '@/lib/db/owl-center-launch'
import { syncPublicSimpleCandyGuards } from '@/lib/owl-center/sync-public-simple-guards'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_PER_TICK = 8

/**
 * GET /api/cron/public-simple-sync-guards
 * Re-pegs partner Candy Guard solPayment (USDC → SOL) and pushes scheduled groups.
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  try {
    const launches = (await listOwlCenterLaunchesAdmin()).filter(
      (l) =>
        l.mint_mode === 'public_simple' &&
        Boolean(l.candy_machine_id || l.devnet_candy_machine_id) &&
        l.active_phase !== 'SOLD_OUT' &&
        l.active_phase !== 'TRADING_ACTIVE'
    )

    const results: Array<{ slug: string; ok: boolean; status?: string; error?: string }> = []
    for (const launch of launches.slice(0, MAX_PER_TICK)) {
      const synced = await syncPublicSimpleCandyGuards(launch)
      if (synced.ok) {
        results.push({ slug: launch.slug, ok: true, status: synced.status })
      } else {
        results.push({ slug: launch.slug, ok: false, error: synced.error })
      }
    }

    return NextResponse.json({
      ok: true,
      considered: launches.length,
      ran: results.length,
      results,
    })
  } catch (e) {
    console.error('public-simple-sync-guards cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
