import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { listRecentFailedClaimAllJobs } from '@/lib/db/staking-claim-all-jobs'
import { claimAllJobToPublicView } from '@/lib/nesting/claim-all-job-runner'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/nesting/claim-all-jobs
 * Recent failed background Claim-all jobs for support.
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminSession(request)
    if (admin instanceof NextResponse) return admin

    const limitRaw = request.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : 20
    const rows = await listRecentFailedClaimAllJobs(Number.isFinite(limit) ? limit : 20)
    return NextResponse.json({
      jobs: rows.map(claimAllJobToPublicView),
      query:
        'select * from staking_claim_all_jobs where status = \'failed\' order by updated_at desc limit 20;',
    })
  } catch (e) {
    console.error('[admin/nesting/claim-all-jobs]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
