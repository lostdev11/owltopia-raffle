import { NextRequest, NextResponse } from 'next/server'

import { requireGeneratorStageSession } from '@/lib/owl-center/generator-stage-auth'
import { prepareSugarZipDirectUpload } from '@/lib/owl-center/stage-sugar-direct-upload'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/owl-center/generator/stage/prepare
 * JSON: { project_id, filename, byte_size } — signed Supabase upload for large Sugar ZIPs.
 */
export async function POST(request: NextRequest) {
  const session = await requireGeneratorStageSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`owl-gen-stage-prepare:${ip}`, 24, 3600_000).allowed) {
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

  const filename = String(body.filename ?? 'sugar-batch.zip').trim() || 'sugar-batch.zip'
  const byteSize = Number(body.byte_size)
  if (!Number.isFinite(byteSize) || byteSize < 1) {
    return jsonError('byte_size required', 400)
  }

  const result = await prepareSugarZipDirectUpload({
    scope: { kind: 'generator', projectId, creatorWallet: session.wallet },
    originalFilename: filename,
    byteSize,
  })
  if (!result.ok) return jsonError(result.error, 400)

  return NextResponse.json({
    ok: true,
    job_id: result.job_id,
    path: result.path,
    signed_url: result.signed_url,
    token: result.token,
  })
}
