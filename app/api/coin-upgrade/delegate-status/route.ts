import { NextResponse } from 'next/server'
import { getCoinArtUpgradeDelegateStatus } from '@/lib/coin-upgrade/delegate-status'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/coin-upgrade/delegate-status
 * Public read-only status for the Gembird authorize page (collection + hot pubkey only).
 */
export async function GET() {
  try {
    const status = await getCoinArtUpgradeDelegateStatus()
    return NextResponse.json(status)
  } catch (e) {
    console.error('[coin-upgrade/delegate-status]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 502 })
  }
}
