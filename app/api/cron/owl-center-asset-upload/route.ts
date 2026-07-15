import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'

import { runAssetUploadWorkerTick } from '@/lib/owl-center/asset-upload-worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/owl-center-asset-upload
 * Processes queued validations + in-progress Arweave upload batches.
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  try {
    const result = await runAssetUploadWorkerTick()
    return NextResponse.json(result)
  } catch (e) {
    console.error('owl-center-asset-upload cron', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
