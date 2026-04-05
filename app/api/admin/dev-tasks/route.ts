import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { createDevTask, listDevTasks } from '@/lib/db/dev-tasks'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/dev-tasks — list backlog (full admin session).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session
    let tasks: Awaited<ReturnType<typeof listDevTasks>>
    try {
      tasks = await listDevTasks()
    } catch (err) {
      console.error('Error fetching dev tasks:', err)
      return NextResponse.json([], { status: 200 })
    }
    return NextResponse.json(tasks)
  } catch (error) {
    console.error('GET dev-tasks:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

/**
 * POST /api/admin/dev-tasks — add task (full admin session).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session
    const body = await request.json().catch(() => ({}))
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }
    const taskBody = typeof body.body === 'string' ? body.body : null
    const task = await createDevTask({
      title,
      body: taskBody,
      created_by: session.wallet,
    })
    if (!task) {
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
    }
    return NextResponse.json(task)
  } catch (error) {
    console.error('POST dev-tasks:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
