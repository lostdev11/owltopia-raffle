import { NextRequest, NextResponse } from 'next/server'

import { advanceGen2PhaseIfScheduled } from '@/lib/owl-center/gen2-phase-advance'
import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { reconcileGen2LaunchMintsFromChain } from '@/lib/owl-center/reconcile-gen2-wallet-mints'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/gen2-phase-advance
 * Vercel Cron: advances Owltopia Gen2 `active_phase` when the current phase is done
 * (sells out, or its window elapses — Gen1 25m, Presale 25m, +13 10m, WL 1h) AND the
 * next phase's open floor is reached (WL +1h/17:00 UTC, Public +2h/18:00 UTC).
 * Holds while the mint is paused/not operational. Secured by CRON_SECRET (Bearer token).
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

    return NextResponse.json({ ...result, reconciled })
  } catch (e) {
    console.error('gen2-phase-advance cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
