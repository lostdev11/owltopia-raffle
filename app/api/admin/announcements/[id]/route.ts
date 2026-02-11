import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/db/admins'
import { updateAnnouncement, deleteAnnouncement } from '@/lib/db/announcements'

export const dynamic = 'force-dynamic'

function getAdminWallet(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.replace('Bearer ', '').trim() || null
}

/**
 * PATCH /api/admin/announcements/[id]
 * Update announcement (admin only).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params
    if (!id) {
      return NextResponse.json(
        { error: 'Announcement ID required' },
        { status: 400 }
      )
    }
    const body = await request.json().catch(() => ({}))
    const attrs: Record<string, unknown> = {}
    if (typeof body.title === 'string') attrs.title = body.title.trim()
    if (body.body !== undefined) attrs.body = typeof body.body === 'string' ? body.body.trim() || null : null
    if (typeof body.show_on_hero === 'boolean') attrs.show_on_hero = body.show_on_hero
    if (typeof body.show_on_raffles === 'boolean') attrs.show_on_raffles = body.show_on_raffles
    if (typeof body.mark_as_new === 'boolean') attrs.mark_as_new = body.mark_as_new
    if (typeof body.active === 'boolean') attrs.active = body.active
    if (typeof body.sort_order === 'number') attrs.sort_order = body.sort_order
    const announcement = await updateAnnouncement(id, attrs as any)
    if (!announcement) {
      return NextResponse.json(
        { error: 'Failed to update announcement' },
        { status: 500 }
      )
    }
    return NextResponse.json(announcement)
  } catch (error) {
    console.error('Error updating announcement:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/announcements/[id]
 * Delete announcement (admin only).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id } = await params
    if (!id) {
      return NextResponse.json(
        { error: 'Announcement ID required' },
        { status: 400 }
      )
    }
    const ok = await deleteAnnouncement(id)
    if (!ok) {
      return NextResponse.json(
        { error: 'Failed to delete announcement' },
        { status: 500 }
      )
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting announcement:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
