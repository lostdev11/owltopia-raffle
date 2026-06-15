import { NextRequest, NextResponse } from 'next/server'

import {
  jobProgressSummary,
  processArweaveUploadUntilComplete,
  startArweaveUploadForJob,
  validateAssetUploadJob,
} from '@/lib/owl-center/asset-upload-worker'
import { getAssetUploadJobById } from '@/lib/db/owl-center-asset-upload-job'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/admin/owl-center/collections/{id}/assets/upload-job
 * Body: { job_id, action: "validate" | "start_arweave" | "process_batch" | "process_all" }
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`admin-owl-upload-job:${ip}`, 60, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) return jsonError('Invalid collection id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  let body: { job_id?: string; action?: string }
  try {
    body = (await request.json()) as { job_id?: string; action?: string }
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const jobId = body.job_id?.trim()
  if (!jobId || !UUID_RE.test(jobId)) return jsonError('Invalid job_id', 400)

  const job = await getAssetUploadJobById(jobId)
  if (!job || job.launch_id !== id) return jsonError('Job not found for this launch', 404)

  const action = body.action?.trim().toLowerCase() ?? 'process_batch'
  let result
  if (action === 'validate') {
    result = await validateAssetUploadJob(jobId)
  } else if (action === 'start_arweave') {
    if (job.status !== 'validated' && job.status !== 'failed') {
      return jsonError(`Job status ${job.status} — cannot start Arweave upload`, 400)
    }
    result = await startArweaveUploadForJob(jobId)
  } else if (action === 'process_all') {
    if (job.status === 'validated' || job.status === 'failed') {
      result = await startArweaveUploadForJob(jobId)
    } else if (job.status === 'uploading') {
      result = await processArweaveUploadUntilComplete(jobId)
    } else if (job.status === 'queued') {
      result = await validateAssetUploadJob(jobId)
    } else {
      return jsonError(`Job status ${job.status} — nothing to process`, 400)
    }
  } else if (action === 'process_batch') {
    if (job.status === 'validated') {
      result = await startArweaveUploadForJob(jobId)
    } else if (job.status === 'uploading') {
      result = await processArweaveUploadUntilComplete(jobId)
    } else if (job.status === 'failed') {
      result = await startArweaveUploadForJob(jobId)
    } else if (job.status === 'queued') {
      result = await validateAssetUploadJob(jobId)
    } else {
      return jsonError(`Job status ${job.status} — nothing to process`, 400)
    }
  } else {
    return jsonError('Invalid action — use validate, start_arweave, process_batch, or process_all', 400)
  }

  const fresh = await getAssetUploadJobById(jobId)
  return NextResponse.json({
    result,
    job: fresh,
    progress: fresh ? jobProgressSummary(fresh) : null,
  })
}
