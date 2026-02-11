import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/db/admins'
import { getAllAnnouncements, createAnnouncement } from '@/lib/db/announcements'

export const dynamic = 'force-dynamic'

function getAdminWallet(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.replace('Bearer ', '').trim() || null
}

/**
 * GET /api/admin/announcements
 * List all announcements (admin only).
 */
export async function GET(request: NextRequest) {
  try {
    const wallet = getAdminWallet(request)
    if (!wallet) {
      return NextResponse.json(
        { error: 'Authorization required (Bearer wallet)' },
        { status: 401 }
      )
    }
    const admin = await isAdmin(wallet)
    if (!admin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      )
    }
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
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/announcements
 * Create announcement (admin only).
 */
export async function POST(request: NextRequest) {
  try {
    const wallet = getAdminWallet(request)
    if (!wallet) {
      return NextResponse.json(
        { error: 'Authorization required (Bearer wallet)' },
        { status: 401 }
      )
    }
    const admin = await isAdmin(wallet)
    if (!admin) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      )
    }
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
        { error: 'Failed to create announcement. Check server logs and ensure SUPABASE_SERVICE_ROLE_KEY is set and migrations are applied.' },
        { status: 500 }
      )
    }
    return NextResponse.json(announcement)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error creating announcement:', error)
    if (message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      return NextResponse.json(
        { error: 'Server misconfigured: ' + message + ' Add it in .env.local (Supabase Dashboard → Settings → API).' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? message : 'Internal server error' },
      { status: 500 }
    )
  }
}
