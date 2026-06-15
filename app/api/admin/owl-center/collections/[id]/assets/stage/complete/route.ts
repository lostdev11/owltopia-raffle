import { NextRequest, NextResponse } from 'next/server'

import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { completeSugarZipDirectUpload } from '@/lib/owl-center/stage-sugar-direct-upload'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/admin/owl-center/collections/{id}/assets/stage/complete
 * JSON: { job_id, path, filename, byte_size } — finalize staged Sugar ZIP job.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-stage-complete:${ip}`, 24, 3600_000).allowed) {
    return jsonError('Too many staging uploads — try later.', 429)
  }

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const jobId = String(body.job_id ?? '').trim()
  const path = String(body.path ?? '').trim()
  if (!jobId || !path) return jsonError('job_id and path required', 400)

  const filename = String(body.filename ?? 'sugar-batch.zip').trim() || 'sugar-batch.zip'
  const byteSize = Number(body.byte_size)
  if (!Number.isFinite(byteSize) || byteSize < 1) {
    return jsonError('byte_size required', 400)
  }

  const result = await completeSugarZipDirectUpload({
    scope: { kind: 'launch', launchId: id },
    jobId,
    path,
    originalFilename: filename,
    byteSize,
  })
  if (!result.ok) return jsonError(result.error, 400)

  return NextResponse.json({
    ok: true,
    job: result.job,
    validation: result.validation,
  })
}
