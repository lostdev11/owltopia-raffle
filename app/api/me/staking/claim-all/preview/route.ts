import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { findReusableClaimPlatformFeeSignature } from '@/lib/nesting/find-reusable-claim-platform-fee'
import { isStakingUserError } from '@/lib/nesting/errors'
import { prepareClaimAllExecution } from '@/lib/nesting/service'
import { isStakingPlatformFeeEnabled } from '@/lib/nesting/staking-platform-fee'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/staking/claim-all/preview
 * Lock checks + fee unit count before the wallet pays the Claim all platform fee.
 */
export async function GET(request: NextRequest) {
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

    const prepared = await prepareClaimAllExecution(session.wallet)

    let reusablePlatformFeeSignature: string | null = null
    if (isStakingPlatformFeeEnabled()) {
      reusablePlatformFeeSignature = await findReusableClaimPlatformFeeSignature({
        wallet: session.wallet,
        minUnits: prepared.feeUnits,
        action: 'claim',
      })
    }

    return NextResponse.json({
      ready: true,
      fee_units: prepared.feeUnits,
      total_owl: prepared.claimableTotal,
      eligible_nest_count: prepared.claimPlans.length,
      preview_nest_count: prepared.previewPlans.length,
      skipped_lock_count: prepared.skippedLocks.length,
      skipped_owl: prepared.skippedOwlPreview,
      reusable_platform_fee_signature: reusablePlatformFeeSignature,
    })
  } catch (e) {
    if (isStakingUserError(e)) {
      return NextResponse.json(
        {
          ready: false,
          error: e.message,
          code: typeof e.extra?.code === 'string' ? e.extra.code : undefined,
          ...e.extra,
        },
        { status: e.status }
      )
    }
    console.error('[me/staking/claim-all/preview]', e)
    return NextResponse.json({ ready: false, error: safeErrorMessage(e) }, { status: 500 })
  }
}
