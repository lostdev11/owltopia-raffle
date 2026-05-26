import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  diagnoseNestingWallet,
  healHolderWalletNests,
  type HealHolderWalletNestsOptions,
} from '@/lib/nesting/admin-wallet-diagnostics'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/staking/heal-wallet
 * Body: {
 *   wallet: string,
 *   clear_pending?: boolean,
 *   clear_active?: boolean,
 *   clear_cross_wallet?: boolean,
 *   full?: boolean — all three (default true when omitted)
 * }
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

    const full = body?.full !== false
    const options: HealHolderWalletNestsOptions = full
      ? { clear_pending: true, clear_active: true, clear_cross_wallet: true }
      : {
          clear_pending: body?.clear_pending === true,
          clear_active: body?.clear_active === true,
          clear_cross_wallet: body?.clear_cross_wallet === true,
        }

    if (!full && !options.clear_pending && !options.clear_active && !options.clear_cross_wallet) {
      return NextResponse.json(
        { error: 'Set full: true or at least one of clear_pending, clear_active, clear_cross_wallet.' },
        { status: 400 }
      )
    }

    const heal = await healHolderWalletNests(wallet, options)
    const diagnostics_after = await diagnoseNestingWallet(wallet)

    console.warn('[admin/staking/heal-wallet]', {
      admin_wallet: session.wallet,
      holder_wallet: wallet,
      ...heal,
    })

    return NextResponse.json({
      ...heal,
      diagnostics_after,
      summary: {
        remaining_high_severity: diagnostics_after.issues.filter((i) => i.severity === 'high').length,
      },
    })
  } catch (e) {
    console.error('[admin/staking/heal-wallet]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
