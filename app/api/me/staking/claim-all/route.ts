import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { executeClaimAll } from '@/lib/nesting/service'
import { isBatchClaimLedgerSyncError } from '@/lib/nesting/batch-claim-errors'
import { isStakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/me/staking/claim-all
 * Claims pending OWL from every active nest for the session wallet (one SPL transfer when configured).
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

    const result = await executeClaimAll({ wallet: session.wallet })

    const txSig =
      typeof result.transaction_signature === 'string' ? result.transaction_signature.trim() : ''

    return NextResponse.json({
      total_claimed: result.total_claimed,
      claim_count: result.claims.length,
      claims: result.claims,
      transaction_signature: txSig || null,
      execution: {
        path: result.execution_path,
      },
    })
  } catch (e) {
    if (isStakingUserError(e)) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    }
    if (isBatchClaimLedgerSyncError(e)) {
      console.error('[me/staking/claim-all] ledger sync failed after transfer', e.txSignature, e)
      return NextResponse.json(
        {
          error:
            'OWL was sent to your wallet. Finishing nest record sync — wait a moment or refresh the page.',
          ledger_sync_failed: true,
          transaction_signature: e.txSignature,
          total_claimed: e.payload.total_claimed,
          claims: e.payload.claims,
        },
        { status: 503 }
      )
    }
    console.error('[me/staking/claim-all]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
