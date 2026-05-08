import { NextRequest, NextResponse } from 'next/server'
import { loadCommunityGiveawayPageBundle } from '@/lib/community-giveaways/page-data'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/community-giveaways/[id]
 * Minimal public metadata (no wallet leakage).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const bundle = await loadCommunityGiveawayPageBundle(id)
    if (!bundle) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }

    return NextResponse.json(bundle.publicInfo)
  } catch (error) {
    console.error('[public/community-giveaways]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
