import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { getCoinArtUpgradeStats } from '@/lib/db/coin-art-upgrades'
import {
  coinArtUpgradeEnvStatus,
  getCoinArtUpgradeFeeSol,
  getCoinArtUpgradeRewardMultiplier,
  isCoinArtUpgradeEnabled,
} from '@/lib/coin-upgrade/config'
import { getCoinArtUpgradeSettings } from '@/lib/db/coin-art-upgrade-settings'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/coin-upgrade/stats — art upgrade sales/progress overview
 * (upgrades sold, SOL collected, catalog coverage, unfinished repairs).
 */
export async function GET(request: NextRequest) {
  const session = await requireAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const [stats, enabled, settings] = await Promise.all([
      getCoinArtUpgradeStats(),
      isCoinArtUpgradeEnabled(),
      getCoinArtUpgradeSettings(),
    ])
    return NextResponse.json({
      enabled,
      upgrades_enabled: settings.upgrades_enabled,
      env: coinArtUpgradeEnvStatus(),
      fee_sol: getCoinArtUpgradeFeeSol(),
      reward_multiplier: getCoinArtUpgradeRewardMultiplier(),
      ...stats,
      sol_collected: stats.lamports_collected / 1e9,
    })
  } catch (e) {
    console.error('[admin/coin-upgrade/stats]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
