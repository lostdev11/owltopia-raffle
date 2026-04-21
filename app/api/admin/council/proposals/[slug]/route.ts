import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { councilProposalPatchBody, parseOr400 } from '@/lib/validations'
import { getCouncilProposalWindowError } from '@/lib/council/owl-proposal-rules'
import { getOwlProposalBySlugAny, updateOwlProposalBySlugAdmin } from '@/lib/db/owl-council'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/council/proposals/[slug]
 * Update proposal (admin).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug?: string }> }
) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const slug = typeof params.slug === 'string' ? params.slug.trim() : ''
    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
    }

    const existing = await getOwlProposalBySlugAny(slug)
    if (!existing) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(councilProposalPatchBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }

    const patch = parsed.data

    if (patch.start_time !== undefined || patch.end_time !== undefined) {
      const mergedStart =
        patch.start_time !== undefined ? patch.start_time : existing.start_time
      const mergedEnd = patch.end_time !== undefined ? patch.end_time : existing.end_time
      const windowErr = getCouncilProposalWindowError(mergedStart, mergedEnd)
      if (windowErr) {
        return NextResponse.json({ error: windowErr }, { status: 400 })
      }
    }

    const result = await updateOwlProposalBySlugAdmin(slug, patch)
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/admin/council/proposals/[slug]] PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
