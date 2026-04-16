import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  appendDevTaskScreenshotPaths,
  DEV_TASK_MAX_SCREENSHOTS_TOTAL,
  getDevTaskScreenshotPathCount,
} from '@/lib/db/dev-tasks'
import { readFormDataFileParts } from '@/lib/form-data-file-parts'
import { DEV_TASK_SCREENSHOT_MAX_FILES, uploadDevTaskScreenshots } from '@/lib/dev-task-storage'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/dev-tasks/[id]/screenshots — append images (full admin, multipart only).
 * Form fields: screenshots (repeatable). Respects max images per task and per request.
 */
export async function POST(
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

    const contentType = request.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Use multipart/form-data with screenshots files' }, { status: 400 })
    }

    const form = await request.formData()
    const files = await readFormDataFileParts(form, 'screenshots')

    if (files.length === 0) {
      return NextResponse.json({ error: 'Add at least one image' }, { status: 400 })
    }
    if (files.length > DEV_TASK_SCREENSHOT_MAX_FILES) {
      return NextResponse.json(
        { error: `At most ${DEV_TASK_SCREENSHOT_MAX_FILES} images per upload. Run again to add more.` },
        { status: 400 }
      )
    }

    const existingCount = await getDevTaskScreenshotPathCount(id)
    if (existingCount === null) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    if (existingCount + files.length > DEV_TASK_MAX_SCREENSHOTS_TOTAL) {
      return NextResponse.json(
        {
          error: `This task already has ${existingCount} image(s). You can have at most ${DEV_TASK_MAX_SCREENSHOTS_TOTAL} per task.`,
        },
        { status: 400 }
      )
    }

    const uploaded = await uploadDevTaskScreenshots(id, files)
    if ('error' in uploaded) {
      return NextResponse.json({ error: uploaded.error }, { status: 400 })
    }

    const task = await appendDevTaskScreenshotPaths(id, uploaded.paths)
    if (!task) {
      return NextResponse.json({ error: 'Could not save screenshots' }, { status: 500 })
    }

    return NextResponse.json(task)
  } catch (error) {
    console.error('POST dev-tasks/[id]/screenshots:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
