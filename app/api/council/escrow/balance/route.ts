import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { isCouncilOwlEscrowVotingEnabled } from '@/lib/council/council-owl-escrow-keypair'
import {
  getOwlCouncilEscrowBalanceRaw,
  getOwlCouncilEscrowVoteLockedRaw,
  listOwlCouncilEscrowVoteLocksForWallet,
} from '@/lib/db/owl-council-escrow'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import { owlRawToDecimalString } from '@/lib/council/owl-amount-format'

export const dynamic = 'force-dynamic'

const HEADER = 'x-connected-wallet'

/**
 * GET /api/council/escrow/balance
 * Signed-in wallet’s credited council escrow OWL (ledger), not live on-chain reconciliation.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isOwlEnabled() || !isCouncilOwlEscrowVotingEnabled()) {
      return NextResponse.json({ enabled: false })
    }

    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connected = request.headers.get(HEADER)?.trim()
    if (!connected || connected !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session.' },
        { status: 401 }
      )
    }

    const owl = getTokenInfo('OWL')
    if (!owl.mintAddress) {
      return NextResponse.json({ error: 'OWL not configured' }, { status: 503 })
    }

    const raw = await getOwlCouncilEscrowBalanceRaw(session.wallet)
    const lockedRaw = await getOwlCouncilEscrowVoteLockedRaw(session.wallet, owl.decimals)
    const withdrawableRaw = raw > lockedRaw ? raw - lockedRaw : 0n
    const balanceDecimal = owlRawToDecimalString(raw, owl.decimals)
    const lockedDecimal = owlRawToDecimalString(lockedRaw, owl.decimals)
    const withdrawableDecimal = owlRawToDecimalString(withdrawableRaw, owl.decimals)

    const voteLockBreakdown = (await listOwlCouncilEscrowVoteLocksForWallet(session.wallet, owl.decimals)).map(
      (r) => ({
        proposalId: r.proposalId,
        slug: r.slug,
        title: r.title,
        lockedDecimal: r.lockedDecimal,
      })
    )

    return NextResponse.json({
      enabled: true,
      balanceRaw: raw.toString(),
      balanceDecimal,
      voteLockedRaw: lockedRaw.toString(),
      voteLockedDecimal: lockedDecimal,
      withdrawableRaw: withdrawableRaw.toString(),
      withdrawableDecimal,
      voteLockBreakdown,
    })
  } catch (error) {
    console.error('[api/council/escrow/balance] GET:', error)
    return NextResponse.json({ error: 'Failed to load balance' }, { status: 500 })
  }
}
