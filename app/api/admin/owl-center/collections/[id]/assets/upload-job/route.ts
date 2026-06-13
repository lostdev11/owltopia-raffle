import { NextRequest, NextResponse } from 'next/server'

import { jobProgressSummary } from '@/lib/owl-center/asset-upload-worker'
import { isIrysUploadConfigured } from '@/lib/owl-center/irys-uploader'
import { getLatestAssetUploadJobForLaunch } from '@/lib/db/owl-center-asset-upload-job'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/owl-center/collections/{id}/assets/upload-job
 * Latest Phase B upload job + progress for this launch.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await requireGen2PresaleAdminSession(request)
  if (session instanceof NextResponse) return session

  const { id } = await context.params
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid collection id' }, { status: 400 })
  }

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return NextResponse.json({ error: 'Launch not found' }, { status: 404 })

  const job = await getLatestAssetUploadJobForLaunch(id)
  return NextResponse.json({
    job,
    progress: job ? jobProgressSummary(job) : null,
    irys_configured: isIrysUploadConfigured(),
  })
}
