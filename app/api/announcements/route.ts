import { NextRequest, NextResponse } from 'next/server'
import { getActiveAnnouncements, hasNewAnnouncements } from '@/lib/db/announcements'

export const dynamic = 'force-dynamic'

/**
 * GET /api/announcements?placement=hero|raffles
 * Returns active announcements for the given placement (public).
 * For placement=raffles, also returns hasNew so the UI can show a notification badge.
 */
export async function GET(request: NextRequest) {
  try {
    const placement = request.nextUrl.searchParams.get('placement') as 'hero' | 'raffles' | null
    const validPlacement = placement === 'hero' || placement === 'raffles' ? placement : 'hero'
    const list = await getActiveAnnouncements(validPlacement)
    const hasNew = validPlacement === 'raffles' ? await hasNewAnnouncements('raffles') : false
    if (validPlacement === 'raffles') {
      return NextResponse.json({ announcements: list, hasNew })
    }
    return NextResponse.json(list)
  } catch (error) {
    console.error('Error fetching announcements:', error)
    return NextResponse.json(
      { error: 'Failed to load announcements' },
      { status: 500 }
    )
  }
}
