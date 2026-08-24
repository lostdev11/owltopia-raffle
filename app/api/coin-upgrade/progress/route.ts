import { NextResponse } from 'next/server'
import { getCoinArtUpgradePublicProgress } from '@/lib/coin-upgrade/public-progress'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/coin-upgrade/progress
 * Public aggregate: how many Owltopia coins have upgraded art vs 1000 total (all wallets).
 */
export async function GET() {
  try {
    const progress = await getCoinArtUpgradePublicProgress()
    return NextResponse.json(progress)
  } catch (e) {
    console.error('[coin-upgrade/progress]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
