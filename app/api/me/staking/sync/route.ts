import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { syncStakingPositionBySignature, type StakingSyncKind } from '@/lib/nesting/sync'
import { isStakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

function isSyncKind(v: unknown): v is StakingSyncKind {
  return v === 'stake' || v === 'unstake' || v === 'claim'
}

/**
 * POST /api/me/staking/sync
 * One `getParsedTransaction` per request — verifies a signature and updates the read model.
 * Body: { position_id, signature, kind: 'stake' | 'unstake' | 'claim' }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => null)
    const position_id = typeof body?.position_id === 'string' ? body.position_id.trim() : ''
    const signature = typeof body?.signature === 'string' ? body.signature.trim() : ''
    const kind = body?.kind

    if (!STAKING_UUID_RE.test(position_id)) {
      return NextResponse.json({ error: 'Invalid position_id' }, { status: 400 })
    }
    if (!signature) {
      return NextResponse.json({ error: 'signature is required' }, { status: 400 })
    }
    if (!isSyncKind(kind)) {
      return NextResponse.json({ error: 'kind must be stake, unstake, or claim' }, { status: 400 })
    }

    const { position } = await syncStakingPositionBySignature({
      positionId: position_id,
      wallet: session.wallet,
      signature,
      kind,
    })

    return NextResponse.json({
      position,
      execution: { path: 'onchain_transaction' as const, rpc_calls: 1 },
    })
  } catch (e) {
    if (isStakingUserError(e)) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    }
    console.error('[me/staking/sync]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
