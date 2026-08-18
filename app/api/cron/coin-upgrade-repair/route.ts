import { NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'
import { isCoinArtUpgradeEnabled } from '@/lib/coin-upgrade/config'
import { repairCoinArtUpgrades } from '@/lib/coin-upgrade/service'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/coin-upgrade-repair (Authorization: Bearer CRON_SECRET)
 * Safety net for paid coin art upgrades: retries Core URI updates that failed
 * after payment and applies any missing nested-reward boosts. Holders are never
 * re-charged — payment rows are consume-once and recorded before the update.
 */
export async function GET(request: Request) {
  const unauthorized = authorizeCronBearer(request)
  if (unauthorized) return unauthorized

  // Keep repairing even if the flag was turned off later — paid upgrades must complete.
  try {
    const summary = await repairCoinArtUpgrades(10)
    return NextResponse.json({ ok: true, enabled: isCoinArtUpgradeEnabled(), ...summary })
  } catch (e) {
    console.error('[cron/coin-upgrade-repair]', e)
    return NextResponse.json({ ok: false, error: safeErrorMessage(e) }, { status: 500 })
  }
}
