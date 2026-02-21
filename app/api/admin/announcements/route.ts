import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getAllAnnouncements, createAnnouncement } from '@/lib/db/announcements'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/announcements
 * List all announcements. Admin only (session required).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session
    let list: Awaited<ReturnType<typeof getAllAnnouncements>>
    try {
      list = await getAllAnnouncements()
    } catch (err) {
      // Table may not exist yet (migration not run) or DB unavailable
      console.error('Error fetching admin announcements:', err)
      return NextResponse.json([], { status: 200 })
    }
    return NextResponse.json(list)
  } catch (error) {
    console.error('Error fetching admin announcements:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/announcements
 * Create announcement. Admin only (session required).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session
    const body = await request.json().catch(() => ({}))
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      )
    }
    const announcement = await createAnnouncement({
      title,
      body: typeof body.body === 'string' ? body.body.trim() || null : null,
      show_on_hero: typeof body.show_on_hero === 'boolean' ? body.show_on_hero : true,
      show_on_raffles: typeof body.show_on_raffles === 'boolean' ? body.show_on_raffles : true,
      mark_as_new: typeof body.mark_as_new === 'boolean' ? body.mark_as_new : false,
      active: typeof body.active === 'boolean' ? body.active : true,
      sort_order: typeof body.sort_order === 'number' ? body.sort_order : 0,
    })
    if (!announcement) {
      return NextResponse.json(
        { error: 'Failed to create announcement' },
        { status: 500 }
      )
    }
    return NextResponse.json(announcement)
  } catch (error) {
    console.error('Error creating announcement:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
