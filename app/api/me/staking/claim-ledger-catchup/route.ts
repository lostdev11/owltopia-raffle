import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { catchUpClaimLedgerForWallet } from '@/lib/nesting/claim-ledger-audit'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/me/staking/claim-ledger-catchup
 * Body: { confirm_owl_received?: boolean }
 *
 * After Claim-all sent OWL but nest rows did not update, align claimed_rewards with accrued
 * so the UI does not offer another Claim all for the same rewards.
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
    if (body?.confirm_owl_received !== true) {
      return NextResponse.json(
        {
          error:
            'Confirm you already received OWL in your wallet (confirm_owl_received: true).',
        },
        { status: 400 }
      )
    }

    const result = await catchUpClaimLedgerForWallet({
      wallet: session.wallet,
      dryRun: false,
      adminWallet: session.wallet,
      note: 'holder_self_catchup_after_ledger_sync_failure',
    })

    return NextResponse.json(result)
  } catch (e) {
    console.error('[me/staking/claim-ledger-catchup]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
