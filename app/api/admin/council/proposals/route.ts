import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { listAllOwlProposalsForAdmin } from '@/lib/db/owl-council'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/council/proposals
 * List all proposals including drafts (admin).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const proposals = await listAllOwlProposalsForAdmin()
    return NextResponse.json({ proposals })
  } catch (error) {
    console.error('[api/admin/council/proposals] GET:', error)
    return NextResponse.json({ error: 'Failed to load proposals' }, { status: 500 })
  }
}

/** Create proposals: POST /api/council/proposals (OWL holders 10+). */
