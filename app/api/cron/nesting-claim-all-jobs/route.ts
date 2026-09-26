import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'
import { processClaimAllJobsCron } from '@/lib/nesting/claim-all-job-runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/nesting-claim-all-jobs
 * Continues in-flight Claim-all jobs (fee already reserved). Secured by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  try {
    const result = await processClaimAllJobsCron(5)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron/nesting-claim-all-jobs]', e)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
