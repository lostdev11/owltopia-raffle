import { NextRequest, NextResponse } from 'next/server'
import {
  getPublishedOwlProposalBySlug,
  sumVoteTotalsForProposal,
} from '@/lib/db/owl-council'

export const dynamic = 'force-dynamic'

/**
 * GET /api/council/proposals/[slug]
 * Public proposal detail + vote totals (aggregated in Supabase reads only).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug?: string }> }
) {
  try {
    const params = await context.params
    const slug = typeof params.slug === 'string' ? params.slug : ''
    if (!slug.trim()) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
    }

    const proposal = await getPublishedOwlProposalBySlug(slug)
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    const voteTotals = await sumVoteTotalsForProposal(proposal.id)
    return NextResponse.json({ proposal, voteTotals })
  } catch (error) {
    console.error('[api/council/proposals/[slug]] GET:', error)
    return NextResponse.json({ error: 'Failed to load proposal' }, { status: 500 })
  }
}

/** Admin update: PATCH /api/admin/council/proposals/[slug] */
