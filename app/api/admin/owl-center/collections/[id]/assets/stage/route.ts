import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import { OWL_CENTER_SYNC_VALIDATE_MAX_BYTES } from '@/lib/owl-center/asset-staging-limits'
import { uploadStagedSugarZip } from '@/lib/owl-center/asset-staging-storage'
import { validateAssetUploadJob } from '@/lib/owl-center/asset-upload-worker'
import { getAssetUploadJobById, insertAssetUploadJob } from '@/lib/db/owl-center-asset-upload-job'
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
  const jobId = randomUUID()
  const staged = await uploadStagedSugarZip(id, jobId, file.buffer, file.name || 'sugar-batch.zip')
  if ('error' in staged) return jsonError(staged.error, 400)

  const job = await insertAssetUploadJob({
    launch_id: id,
    staged_zip_path: staged.path,
    original_filename: file.name || null,
  })
  if (!job) return jsonError('Could not create upload job', 500)

  let validation = null
  if (file.buffer.length <= OWL_CENTER_SYNC_VALIDATE_MAX_BYTES) {
    validation = await validateAssetUploadJob(job.id)
  }

  const fresh = validation ? await getAssetUploadJobById(job.id) : job

  return NextResponse.json({
    ok: true,
    job: fresh ?? job,
    validation,
  })
}
