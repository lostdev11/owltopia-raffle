import { NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'
import { processCoinArtUpgradeUploadJobsTick } from '@/lib/coin-upgrade/art-upload-worker'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/coin-upgrade-art-upload
 * Continues queued / uploading / seeding coin art ZIP jobs (Irys + catalog seed).
 */
export async function GET(request: Request) {
  const unauthorized = authorizeCronBearer(request)
  if (unauthorized) return unauthorized
  try {
    const summary = await processCoinArtUpgradeUploadJobsTick()
    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    console.error('[cron/coin-upgrade-art-upload]', e)
    return NextResponse.json({ ok: false, error: safeErrorMessage(e) }, { status: 500 })
  }
}
