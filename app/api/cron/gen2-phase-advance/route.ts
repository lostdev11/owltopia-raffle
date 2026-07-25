import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'

import { advanceGen2PhaseIfScheduled } from '@/lib/owl-center/gen2-phase-advance'
import { flushPendingGen2MintDiscordFeed } from '@/lib/owl-center/gen2-mint-discord-feed'
import { ensureGen2TeamBackstopAutoEnabled } from '@/lib/owl-center/gen2-backstop-ops'
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { reconcileGen2LaunchMintsFromChain } from '@/lib/owl-center/reconcile-gen2-wallet-mints'
import { isGen2PublicMintRetired } from '@/lib/owl-center/mint-policy'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/gen2-phase-advance
 * Soft-retired while Gen2 mint is sold out (see isGen2PublicMintRetired).
 * Route kept for manual/ops use if GEN2_PUBLIC_MINT_ENABLED=true.
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  if (isGen2PublicMintRetired()) {
    return NextResponse.json({
      ok: true,
      status: 'skipped',
      reason: 'gen2_mint_retired',
    })
  }

  try {
    const result = await advanceGen2PhaseIfScheduled()
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
    }

    // Best-effort: backfill any on-chain Gen2 mints whose client-side confirm was cut short, so the
    // DB ledger (and the per-phase / supply counters derived from it) self-heals server-side. Never
    // let a reconcile failure fail the phase-advance cron.
    let reconciled = 0
    try {
      const adminLaunch = await getOwlCenterLaunchBySlugAdmin('gen2')
      if (adminLaunch) {
        reconciled = (await reconcileGen2LaunchMintsFromChain(adminLaunch)).recorded
      }
    } catch (e) {
      console.error('gen2-phase-advance reconcile', e)
    }

    let discord_flushed = 0
    try {
      discord_flushed = await flushPendingGen2MintDiscordFeed({ limit: 25 })
    } catch (e) {
      console.error('gen2-phase-advance discord flush', e)
    }

    // Self-heal: public pool empty + leftovers → enable team backstop if not already on.
    let team_backstop: unknown = null
    try {
      team_backstop = await ensureGen2TeamBackstopAutoEnabled()
    } catch (e) {
      console.error('gen2-phase-advance team backstop', e)
      team_backstop = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    return NextResponse.json({ ...result, reconciled, discord_flushed, team_backstop })
  } catch (e) {
    console.error('gen2-phase-advance cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
