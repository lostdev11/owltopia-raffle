import { NextRequest, NextResponse } from 'next/server'
import {
  getGenOwlNestPublicStats,
  parseGenOwlNestStatsGroup,
} from '@/lib/nesting/gen-owl-nest-stats'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nesting/gen-owl-nest-stats?group=gen1-owl|gen2-owl
 * Public aggregate: how many Gen 1 / Gen 2 owl nest slots are in use vs collection capacity (all wallets).
 */
export async function GET(req: NextRequest) {
  try {
    const group = parseGenOwlNestStatsGroup(req.nextUrl.searchParams.get('group'))
    if (!group) {
      return NextResponse.json(
        { error: 'Query group must be gen1-owl or gen2-owl.' },
        { status: 400 }
      )
    }

    const stats = await getGenOwlNestPublicStats(group)
    if (!stats) {
      return NextResponse.json(
        { error: `${group} nesting perches are not configured.` },
        { status: 404 }
      )
    }
    return NextResponse.json(stats)
  } catch (e) {
    console.error('[nesting/gen-owl-nest-stats]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
