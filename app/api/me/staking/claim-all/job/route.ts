import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getActiveClaimAllJobForWallet } from '@/lib/db/staking-claim-all-jobs'
import { claimAllJobToPublicView } from '@/lib/nesting/claim-all-job-runner'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/staking/claim-all/job
 * Active background Claim-all job for the session wallet (poll optional).
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

    const job = await getActiveClaimAllJobForWallet(session.wallet)
    if (!job) {
      return NextResponse.json({ job: null })
    }

    return NextResponse.json({ job: claimAllJobToPublicView(job) })
  } catch (e) {
    console.error('[me/staking/claim-all/job]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
