import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { councilVoteBody, parseOr400 } from '@/lib/validations'
import {
  getPublishedOwlProposalBySlug,
  insertOwlVote,
} from '@/lib/db/owl-council'
import { isCouncilVotingOpen } from '@/lib/council/proposal-status'
import { resolveVotingPowerForOwlVote } from '@/lib/council/voting-power'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/council/proposals/[slug]/vote
 * Requires SIWS session + X-Connected-Wallet matching session (same as dashboard).
 * voting_power = OWL balance at vote time (weighted governance).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug?: string }> }
) {
  try {
    const params = await context.params
    const slug = typeof params.slug === 'string' ? params.slug.trim() : ''
    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
    }

    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connected = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (!connected || connected !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Sign in with the connected wallet.' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(councilVoteBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }

    const proposal = await getPublishedOwlProposalBySlug(slug)
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    if (!isCouncilVotingOpen(proposal)) {
      return NextResponse.json(
        { error: 'Voting is not open for this proposal.' },
        { status: 403 }
      )
    }

    const powerRes = await resolveVotingPowerForOwlVote(session.wallet, proposal)
    if (!powerRes.ok) {
      const status =
        powerRes.code === 'no_owl'
          ? 403
          : powerRes.code === 'invalid_wallet'
            ? 400
            : powerRes.code === 'owl_disabled'
              ? 503
              : 503
      return NextResponse.json({ error: powerRes.message }, { status })
    }

    const result = await insertOwlVote({
      proposalId: proposal.id,
      wallet: session.wallet,
      voteChoice: parsed.data.vote_choice,
      votingPower: powerRes.weightDecimal,
    })

    if (!result.ok) {
      if (result.code === 'duplicate') {
        return NextResponse.json({ error: result.message }, { status: 409 })
      }
      return NextResponse.json({ error: result.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/council/vote] POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
