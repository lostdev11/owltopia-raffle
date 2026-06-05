import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { clearGhostActiveNestsForWallet } from '@/lib/nesting/clear-ghost-active-nests'
import { diagnoseNestingWallet } from '@/lib/nesting/admin-wallet-diagnostics'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/staking/clear-ghost-active
 * Body: { wallet: string }
 *
 * Closes active nest rows with no mint in the ledger. Does not affect real nests or on-chain coins.
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => null)
    const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
    if (!wallet) {
      return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
    }

    const result = await clearGhostActiveNestsForWallet(wallet)
    const diagnostics_after =
      result.cleared_count > 0 ? await diagnoseNestingWallet(wallet, { skipLockSamples: true }) : undefined

    console.warn('[admin/staking/clear-ghost-active]', {
      admin_wallet: session.wallet,
      holder_wallet: wallet,
      ghost_active_count: result.ghost_active_count,
      cleared_count: result.cleared_count,
    })

    return NextResponse.json({
      ...result,
      diagnostics_after,
    })
  } catch (e) {
    console.error('[admin/staking/clear-ghost-active]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
