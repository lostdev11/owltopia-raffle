import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { catchUpClaimLedgerForWallet } from '@/lib/nesting/claim-ledger-audit'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/staking/claim-ledger-catchup
 * Body: { wallet: string, dry_run?: boolean, note?: string }
 *
 * Sets each active OWL nest's claimed_rewards to current accrued (ledger adjustment rows).
 * Use after on-chain Claim-all payouts when DB sync failed — prevents another Claim all.
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

    const dryRun = body?.dry_run === true || body?.dry_run === 1
    const note = typeof body?.note === 'string' ? body.note.trim() : undefined

    const result = await catchUpClaimLedgerForWallet({
      wallet,
      dryRun,
      adminWallet: session.wallet,
      note,
    })

    console.warn('[admin/staking/claim-ledger-catchup]', {
      admin_wallet: session.wallet,
      holder_wallet: wallet,
      dry_run: dryRun,
      positions_updated: result.positions_updated,
      total_claimable_zeroed_owl: result.total_claimable_zeroed_owl,
    })

    return NextResponse.json(result)
  } catch (e) {
    console.error('[admin/staking/claim-ledger-catchup]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
