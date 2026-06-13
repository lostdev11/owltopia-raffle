import { NextRequest, NextResponse } from 'next/server'

import { validateAssetUploadJob } from '@/lib/owl-center/asset-upload-worker'
import { requireGeneratorStageSession } from '@/lib/owl-center/generator-stage-auth'
import { getAssetUploadJobById } from '@/lib/db/owl-center-asset-upload-job'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/owl-center/generator/stage/process
 * Trigger validation for a queued generator staging job.
 */
export async function POST(request: NextRequest) {
  const session = await requireGeneratorStageSession(request)
  if (session instanceof NextResponse) return session

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : ''
  if (!jobId || !UUID_RE.test(jobId)) return jsonError('job_id required', 400)

  const job = await getAssetUploadJobById(jobId)
  if (!job?.generator_project_id) return jsonError('Job not found', 404)

  const validation = await validateAssetUploadJob(jobId)
  const fresh = await getAssetUploadJobById(jobId)

  return NextResponse.json({ ok: validation.ok, job: fresh, validation })
}
