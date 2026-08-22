import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { isIrysUploadConfigured } from '@/lib/owl-center/irys-config'
import { getLatestCoinArtUpgradeUploadJob } from '@/lib/db/coin-art-upgrade-upload-jobs'
import { countCoinArtUpgradeCatalogEntries } from '@/lib/db/coin-art-upgrades'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/coin-upgrade/art/upload-job — latest art ZIP job + catalog size.
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const [job, catalogSize] = await Promise.all([
      getLatestCoinArtUpgradeUploadJob(),
      countCoinArtUpgradeCatalogEntries(),
    ])
    const progress = job?.upload_progress
    const total = progress?.total_files ?? 0
    const uploaded = progress?.uploaded_files ?? 0
    return NextResponse.json({
      job,
      progress:
        total > 0
          ? {
              total_files: total,
              uploaded_files: uploaded,
              percent: Math.min(100, Math.round((uploaded / total) * 100)),
            }
          : null,
      catalog_size: catalogSize,
      irys_configured: isIrysUploadConfigured(),
    })
  } catch (e) {
    console.error('[admin/coin-upgrade/art/upload-job GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
