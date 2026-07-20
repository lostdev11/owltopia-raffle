import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getStakingPoolById } from '@/lib/db/staking-pools'
import { getStakingPositionForWallet, patchStakingPosition } from '@/lib/db/staking-positions'
import { stakingPositionHasPlatformFeeLinked } from '@/lib/db/staking-platform-fee-payments'
import { assertWalletNftFrozenForPool } from '@/lib/nesting/nft-lock-service'
import { requireStakingPlatformFeeLinked } from '@/lib/nesting/link-staking-platform-fee'
import { StakingUserError, isStakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'
import { isStakingPlatformFeeEnabled } from '@/lib/nesting/staking-platform-fee'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/me/staking/freeze
 * Freezes an already-recorded NFT nest in the holder wallet (migration path for DB-only stakes).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => null)
    const positionId = typeof body?.position_id === 'string' ? body.position_id.trim() : ''
    const signature = typeof body?.signature === 'string' && body.signature.trim() ? body.signature.trim() : null
    if (!STAKING_UUID_RE.test(positionId)) {
      return NextResponse.json({ error: 'Invalid position_id' }, { status: 400 })
    }

    const position = await getStakingPositionForWallet(positionId, session.wallet)
    if (!position) throw new StakingUserError('Position not found', 404)
    if (position.status === 'unstaked') throw new StakingUserError('Position is already closed.', 400)
    if (!position.asset_identifier?.trim()) {
      throw new StakingUserError('NFT asset id is missing for this nest.', 400)
    }

    // Already confirmed — return success so client retries / "Finish opening" do not
    // re-charge or hit stale fee errors after a lost first response.
    if (
      position.status === 'active' &&
      (position.external_reference ?? '').startsWith('nft_freeze_confirmed:')
    ) {
      return NextResponse.json({
        position,
        execution: {
          path: 'onchain_nft_freeze' as const,
          signature: signature ?? position.stake_signature,
        },
      })
    }

    const pool = await getStakingPoolById(position.pool_id)
    if (!pool || pool.asset_type !== 'nft' || pool.adapter_mode !== 'onchain_enabled') {
      throw new StakingUserError('This nest is not configured for NFT freeze locks.', 400)
    }

    const frozen = await assertWalletNftFrozenForPool({
      pool,
      ownerWallet: session.wallet,
      assetId: position.asset_identifier,
      collectionMint: pool.collection_key,
    })

    // Fee already linked (retry / Finish opening after a paid lock) — do not require a new signature.
    const feeAlreadyLinked =
      isStakingPlatformFeeEnabled() &&
      (await stakingPositionHasPlatformFeeLinked(position.id, 'stake'))

    if (!feeAlreadyLinked) {
      await requireStakingPlatformFeeLinked({
        wallet: session.wallet,
        action: 'stake',
        feeSignature: body?.platform_fee_signature,
        positionIds: [position.id],
      })
    }

    const updated = await patchStakingPosition(position.id, {
      status: 'active',
      stake_signature: signature ?? position.stake_signature ?? null,
      sync_status: 'confirmed',
      last_synced_at: new Date().toISOString(),
      last_transaction_error: null,
      external_reference: `nft_freeze_confirmed:${frozen.tokenAccount}`,
    })

    return NextResponse.json({
      position: updated,
      execution: { path: 'onchain_nft_freeze' as const, signature },
    })
  } catch (e) {
    if (isStakingUserError(e)) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    }
    console.error('[me/staking/freeze]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
