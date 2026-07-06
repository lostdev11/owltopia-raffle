import { NextResponse } from 'next/server'
import { getGenOwlRevShareSnapshot } from '@/lib/nesting/gen-owl-rev-share-snapshot'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nesting/gen-owl-rev-share
 * Public. Founder-set Gen 1 / Gen 2 rev share totals + even split per active nest.
 */
export async function GET() {
  try {
    const snapshot = await getGenOwlRevShareSnapshot()
    if (!snapshot) {
      return NextResponse.json({
        next_date: null,
        gen1: null,
        gen2: null,
      })
    }
    return NextResponse.json(snapshot)
  } catch (e) {
    console.error('[gen-owl-rev-share]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
