import { NextRequest, NextResponse } from 'next/server'
import { deleteEntry, getEntryById } from '@/lib/db/entries'
import { requireAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'

// Force dynamic rendering since we use request body and params
export const dynamic = 'force-dynamic'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const entryId = params.id
    if (typeof entryId !== 'string') {
      return NextResponse.json({ error: 'Invalid entry id' }, { status: 400 })
    }

    const existingEntry = await getEntryById(entryId)
    if (!existingEntry) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      )
    }

    if (existingEntry.status !== 'pending') {
      return NextResponse.json(
        { error: 'Only pending entries can be removed. Confirmed or rejected entries cannot be deleted.' },
        { status: 400 }
      )
    }

    const success = await deleteEntry(entryId, session.wallet)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to delete entry' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, message: 'Entry deleted successfully' })
  } catch (error) {
    console.error('Error deleting entry:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
