import { NextRequest, NextResponse } from 'next/server'

import { requireGeneratorStageSession } from '@/lib/owl-center/generator-stage-auth'
import { stageSugarPackageZip } from '@/lib/owl-center/stage-sugar-package'
import { buildUploadJobApiPayload } from '@/lib/owl-center/upload-job-api-payload'
import { getLatestAssetUploadJobForGeneratorProject } from '@/lib/db/owl-center-asset-upload-job'
import { readFormDataFileParts } from '@/lib/form-data-file-parts'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * GET /api/owl-center/generator/stage?project_id=...
 * Latest pre-launch staging job for a generator project.
 */
export async function GET(request: NextRequest) {
  const session = await requireGeneratorStageSession(request)
  if (session instanceof NextResponse) return session

  const projectId = request.nextUrl.searchParams.get('project_id')?.trim()
  if (!projectId) return jsonError('project_id required', 400)

  const job = await getLatestAssetUploadJobForGeneratorProject(projectId)
  return NextResponse.json(await buildUploadJobApiPayload(job))
}

/**
 * POST /api/owl-center/generator/stage
 * multipart/form-data: zip + project_id — stage Sugar export before launch submit.
 */
export async function POST(request: NextRequest) {
  const session = await requireGeneratorStageSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`owl-gen-stage:${ip}`, 12, 3600_000).allowed) {
    return jsonError('Too many staging uploads — try later.', 429)
  }

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return jsonError('Use multipart/form-data with zip and project_id', 400)
  }

  const form = await request.formData()
  const projectId = String(form.get('project_id') ?? '').trim()
  if (!projectId) return jsonError('project_id required', 400)

  const files = await readFormDataFileParts(form, 'zip')
  if (files.length !== 1) {
    return jsonError('Upload exactly one Sugar ZIP as field "zip"', 400)
  }

  const [file] = files
  const result = await stageSugarPackageZip({
    buffer: file.buffer,
    originalFilename: file.name || 'sugar-batch.zip',
    scope: { kind: 'generator', projectId, creatorWallet: session.wallet },
  })
  if (!result.ok) return jsonError(result.error, 400)

  return NextResponse.json({
    ok: true,
    job: result.job,
    validation: result.validation,
  })
}
