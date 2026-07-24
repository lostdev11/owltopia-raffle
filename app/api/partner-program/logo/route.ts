import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import {
  DEV_TASK_SCREENSHOTS_BUCKET,
  isAllowedScreenshotFile,
  publicUrlForScreenshotPath,
} from '@/lib/dev-task-storage'
import { readFormDataFileParts } from '@/lib/form-data-file-parts'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/** Public form — keep the per-IP budget tight (uploads are ~MBs each). */
const UPLOADS_PER_HOUR = 10

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/partner-program/logo
 * multipart/form-data with a single `image` file — the applicant's community logo.
 * Unauthenticated (used on the public partner application form); returns { url, path }.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  if (!rateLimit(`partner-apply-logo:${ip}`, UPLOADS_PER_HOUR, 3600_000).allowed) {
    return jsonError('Too many uploads — try again later.', 429)
  }

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return jsonError('Use multipart/form-data with an image file', 400)
  }

  const form = await request.formData()
  const files = await readFormDataFileParts(form, 'image')
  if (files.length !== 1) {
    return jsonError('Upload one image at a time', 400)
  }

  const [file] = files
  const check = isAllowedScreenshotFile({
    type: file.type,
    name: file.name,
    size: file.buffer.length,
  })
  if (!check.ok) return jsonError(check.error, 400)

  const path = `partner-application-logos/${Date.now()}-${randomUUID()}.${check.ext}`
  const contentTypeToSave =
    file.type && file.type.startsWith('image/')
      ? file.type.split(';')[0].trim()
      : `image/${check.ext === 'jpg' ? 'jpeg' : check.ext}`

  const { error } = await getSupabaseAdmin()
    .storage.from(DEV_TASK_SCREENSHOTS_BUCKET)
    .upload(path, file.buffer, {
      contentType: contentTypeToSave,
      upsert: false,
    })

  if (error) {
    console.error('POST /api/partner-program/logo upload failed:', error)
    return jsonError('Upload failed. Try another image.', 500)
  }

  return NextResponse.json({
    url: publicUrlForScreenshotPath(path),
    path,
  })
}
