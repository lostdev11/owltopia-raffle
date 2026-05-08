import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { readFormDataFileParts } from '@/lib/form-data-file-parts'
import {
  DEV_TASK_SCREENSHOTS_BUCKET,
  isAllowedScreenshotFile,
  publicUrlForScreenshotPath,
} from '@/lib/dev-task-storage'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/upload/image (admin only)
 * multipart/form-data with a single `image` file.
 *
 * Returns:
 * { url: string, path: string }
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Use multipart/form-data with an image file' }, { status: 400 })
  }

  const form = await request.formData()
  const files = await readFormDataFileParts(form, 'image')
  if (files.length < 1) {
    return NextResponse.json({ error: 'Add an image file' }, { status: 400 })
  }
  if (files.length > 1) {
    return NextResponse.json({ error: 'Upload one image at a time' }, { status: 400 })
  }

  const [file] = files
  const check = isAllowedScreenshotFile({
    type: file.type,
    name: file.name,
    size: file.buffer.length,
  })
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 })
  }

  const ext = check.ext
  const safeWallet = session.wallet.replace(/[^a-zA-Z0-9_-]/g, '')
  const path = `raffle-fallbacks/${safeWallet}/${Date.now()}-${randomUUID()}.${ext}`
  const contentTypeToSave =
    file.type && file.type.startsWith('image/')
      ? file.type.split(';')[0].trim()
      : `image/${ext === 'jpg' ? 'jpeg' : ext}`

  const { error } = await getSupabaseAdmin()
    .storage.from(DEV_TASK_SCREENSHOTS_BUCKET)
    .upload(path, file.buffer, {
      contentType: contentTypeToSave,
      upsert: false,
    })

  if (error) {
    console.error('POST /api/upload/image upload failed:', error)
    return NextResponse.json({ error: 'Upload failed. Please try another image.' }, { status: 500 })
  }

  return NextResponse.json({
    url: publicUrlForScreenshotPath(path),
    path,
  })
}
