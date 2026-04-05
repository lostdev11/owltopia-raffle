import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { deleteDevTask, updateDevTask } from '@/lib/db/dev-tasks'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/dev-tasks/[id] — update title, body, or status.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session
    const { id } = await context.params
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }
    const body = await request.json().catch(() => ({}))
    const updates: Parameters<typeof updateDevTask>[1] = {}
    if (typeof body.title === 'string') updates.title = body.title.trim()
    if (body.body === null || typeof body.body === 'string') updates.body = body.body
    if (body.status === 'open' || body.status === 'done') updates.status = body.status
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }
    if (updates.title !== undefined && !updates.title) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
    }
    const task = await updateDevTask(id, updates)
    if (!task) {
      return NextResponse.json({ error: 'Task not found or update failed' }, { status: 404 })
    }
    return NextResponse.json(task)
  } catch (error) {
    console.error('PATCH dev-tasks/[id]:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/dev-tasks/[id]
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session
    const { id } = await context.params
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }
    const ok = await deleteDevTask(id)
    if (!ok) {
      return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE dev-tasks/[id]:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
