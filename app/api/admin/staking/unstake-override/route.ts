import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { executeUnstakeAdminOverride } from '@/lib/nesting/service'
import { isStakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/staking/unstake-override
 * Body: { position_id: string } — UUID of `staking_positions.id` for the nest to close.
 * Runs the same adapter path as the holder "Leave nest" (thaw NFT or return tokens from vault).
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => null)
    const position_id = typeof body?.position_id === 'string' ? body.position_id.trim() : ''

    const { position } = await executeUnstakeAdminOverride({ position_id })

    console.warn('[admin/staking/unstake-override]', {
      admin_wallet: session.wallet,
      position_id,
      holder_wallet: position.wallet_address,
    })

    return NextResponse.json({
      position,
      holder_wallet: position.wallet_address,
      admin_override: true,
      execution: {
        path: position.unstake_signature ? ('onchain_token_transfer' as const) : ('database_mock' as const),
      },
    })
  } catch (e) {
    if (isStakingUserError(e)) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    }
    console.error('[admin/staking/unstake-override]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
