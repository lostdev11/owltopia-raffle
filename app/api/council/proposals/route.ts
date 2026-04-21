import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import {
  listPublishedOwlProposals,
  type OwlVoteBucket,
} from '@/lib/db/owl-council'
import { councilProposalCreateBody, parseOr400 } from '@/lib/validations'
import { assertWalletHasMinOwlForCouncilProposal } from '@/lib/council/min-owl-for-proposal'
import { getCouncilProposalWindowError } from '@/lib/council/owl-proposal-rules'
import { resolveCouncilProposalCreateSlug } from '@/lib/council/council-slug'
import { createOwlProposalAdmin } from '@/lib/db/owl-council'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

const BUCKETS: OwlVoteBucket[] = ['active', 'upcoming', 'past', 'all']

function parseBucket(raw: string | null): OwlVoteBucket {
  if (raw && BUCKETS.includes(raw as OwlVoteBucket)) {
    return raw as OwlVoteBucket
  }
  return 'all'
}

/**
 * GET /api/council/proposals?bucket=active|upcoming|past|all
 * Public list of published proposals (Supabase only).
 */
export async function GET(request: NextRequest) {
  try {
    const bucket = parseBucket(request.nextUrl.searchParams.get('bucket'))
    const proposals = await listPublishedOwlProposals(bucket)
    return NextResponse.json({ bucket, proposals })
  } catch (error) {
    console.error('[api/council/proposals] GET:', error)
    return NextResponse.json({ error: 'Failed to load proposals' }, { status: 500 })
  }
}

/**
 * POST /api/council/proposals
 * OWL holders (10+ OWL) with SIWS session may submit proposals as **draft**. Admins publish (set active) from Owl Vision.
 */
export async function POST(request: NextRequest) {
  try {
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
    const parsed = parseOr400(councilProposalCreateBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }

    const windowErr = getCouncilProposalWindowError(parsed.data.start_time, parsed.data.end_time)
    if (windowErr) {
      return NextResponse.json({ error: windowErr }, { status: 400 })
    }

    const owlGate = await assertWalletHasMinOwlForCouncilProposal(session.wallet)
    if (!owlGate.ok) {
      return NextResponse.json({ error: owlGate.error }, { status: owlGate.status })
    }

    const slugRes = resolveCouncilProposalCreateSlug(parsed.data.slug, parsed.data.title)
    if (!slugRes.ok) {
      return NextResponse.json({ error: slugRes.message }, { status: 400 })
    }

    const result = await createOwlProposalAdmin({
      ...parsed.data,
      slug: slugRes.slug,
      created_by: session.wallet,
      status: 'draft',
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, id: result.id })
  } catch (error) {
    console.error('[api/council/proposals] POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
