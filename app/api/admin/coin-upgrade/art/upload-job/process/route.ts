import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  continueCoinArtUpgradeArweaveUpload,
  reseedCoinArtUpgradeCatalogFromJob,
  startCoinArtUpgradeArweaveUpload,
  validateCoinArtUpgradeUploadJob,
} from '@/lib/coin-upgrade/art-upload-worker'
import { getCoinArtUpgradeUploadJobById } from '@/lib/db/coin-art-upgrade-upload-jobs'
import { countCoinArtUpgradeCatalogEntries } from '@/lib/db/coin-art-upgrades'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/coin-upgrade/art/upload-job/process
 * Body: { job_id, action: 'validate' | 'start_arweave' | 'process_all' | 'reseed_catalog' }
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => null)
    const jobId = typeof body?.job_id === 'string' ? body.job_id.trim() : ''
    const action = typeof body?.action === 'string' ? body.action.trim() : ''
    if (!jobId) {
      return NextResponse.json({ error: 'job_id is required.' }, { status: 400 })
    }

    let result
    if (action === 'validate') {
      result = await validateCoinArtUpgradeUploadJob(jobId)
    } else if (action === 'start_arweave') {
      result = await startCoinArtUpgradeArweaveUpload(jobId)
    } else if (action === 'process_all') {
      result = await continueCoinArtUpgradeArweaveUpload(jobId, 'full')
    } else if (action === 'reseed_catalog') {
      result = await reseedCoinArtUpgradeCatalogFromJob(jobId)
    } else {
      return NextResponse.json(
        { error: 'action must be validate | start_arweave | process_all | reseed_catalog.' },
        { status: 400 }
      )
    }

    const job = await getCoinArtUpgradeUploadJobById(jobId)
    const progress = job?.upload_progress
    const total = progress?.total_files ?? 0
    const uploaded = progress?.uploaded_files ?? 0
    const catalogSize = await countCoinArtUpgradeCatalogEntries()
    return NextResponse.json({
      result,
      job,
      catalog_size: catalogSize,
      progress:
        total > 0
          ? {
              total_files: total,
              uploaded_files: uploaded,
              percent: Math.min(100, Math.round((uploaded / total) * 100)),
            }
          : null,
    })
  } catch (e) {
    console.error('[admin/coin-upgrade/art/upload-job/process]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
