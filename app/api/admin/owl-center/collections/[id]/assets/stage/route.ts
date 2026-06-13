import { NextRequest, NextResponse } from 'next/server'

import { stageSugarPackageZip } from '@/lib/owl-center/stage-sugar-package'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { readFormDataFileParts } from '@/lib/form-data-file-parts'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/admin/owl-center/collections/{id}/assets/stage
 * multipart/form-data field `zip` — Sugar export ZIP (Phase B staging).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-stage:${ip}`, 12, 3600_000).allowed) {
    return jsonError('Too many staging uploads — try later.', 429)
  }

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return jsonError('Use multipart/form-data with a zip file', 400)
  }

  const form = await request.formData()
  const files = await readFormDataFileParts(form, 'zip')
  if (files.length !== 1) {
    return jsonError('Upload exactly one Sugar ZIP as field "zip"', 400)
  }

  const [file] = files
  const result = await stageSugarPackageZip({
    buffer: file.buffer,
    originalFilename: file.name || 'sugar-batch.zip',
    scope: { kind: 'launch', launchId: id },
  })
  if (!result.ok) return jsonError(result.error, 400)

  return NextResponse.json({
    ok: true,
    job: result.job,
    validation: result.validation,
  })
}
