import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  createDevTask,
  deleteDevTask,
  DEV_TASK_MAX_SCREENSHOTS_TOTAL,
  listDevTasks,
  updateDevTask,
} from '@/lib/db/dev-tasks'
import { readFormDataFileParts } from '@/lib/form-data-file-parts'
import { uploadDevTaskScreenshots } from '@/lib/dev-task-storage'
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
 * JSON: { title, body? }
 * multipart/form-data: title, body?, screenshots (repeatable File fields)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const titleRaw = form.get('title')
      const title = typeof titleRaw === 'string' ? titleRaw.trim() : ''
      if (!title) {
        return NextResponse.json({ error: 'Title is required' }, { status: 400 })
      }
      const rawBody = form.get('body')
      const taskBody = typeof rawBody === 'string' ? rawBody : null

      const files = await readFormDataFileParts(form, 'screenshots')
      if (files.length > DEV_TASK_MAX_SCREENSHOTS_TOTAL) {
        return NextResponse.json(
          { error: `At most ${DEV_TASK_MAX_SCREENSHOTS_TOTAL} images per task (use Add more photos for the rest).` },
          { status: 400 }
        )
      }

      const task = await createDevTask({
        title,
        body: taskBody,
        created_by: session.wallet,
        screenshot_paths: [],
      })
      if (!task) {
        return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
      }

      if (files.length === 0) {
        return NextResponse.json(task)
      }

      const uploaded = await uploadDevTaskScreenshots(task.id, files)
      if ('error' in uploaded) {
        await deleteDevTask(task.id)
        return NextResponse.json({ error: uploaded.error }, { status: 400 })
      }

      const updated = await updateDevTask(task.id, { screenshot_paths: uploaded.paths })
      return NextResponse.json(updated ?? task)
    }

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
