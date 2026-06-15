import { NextRequest, NextResponse } from 'next/server'

import { requireGeneratorStageSession } from '@/lib/owl-center/generator-stage-auth'
import { completeSugarZipDirectUpload } from '@/lib/owl-center/stage-sugar-direct-upload'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/owl-center/generator/stage/complete
 * JSON: { project_id, job_id, path, filename, byte_size } — finalize staged Sugar ZIP job.
 */
export async function POST(request: NextRequest) {
  const session = await requireGeneratorStageSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`owl-gen-stage-complete:${ip}`, 24, 3600_000).allowed) {
    return jsonError('Too many staging uploads — try later.', 429)
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const projectId = String(body.project_id ?? '').trim()
  if (!projectId) return jsonError('project_id required', 400)

  const jobId = String(body.job_id ?? '').trim()
  const path = String(body.path ?? '').trim()
  if (!jobId || !path) return jsonError('job_id and path required', 400)

  const filename = String(body.filename ?? 'sugar-batch.zip').trim() || 'sugar-batch.zip'
  const byteSize = Number(body.byte_size)
  if (!Number.isFinite(byteSize) || byteSize < 1) {
    return jsonError('byte_size required', 400)
  }

  const result = await completeSugarZipDirectUpload({
    scope: { kind: 'generator', projectId, creatorWallet: session.wallet },
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
