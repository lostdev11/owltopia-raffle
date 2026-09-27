import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronBearer } from '@/lib/cron-auth'
import { runPackOpenReconcile } from '@/lib/packs/pack-open-reconcile'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/pack-open-reconcile
 * Resume stuck pack opens (paying_out / rolling / reserved) and match orphan payments.
 */
export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronBearer(request)
  if (cronAuth) return cronAuth

  try {
    const result = await runPackOpenReconcile()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('Cron pack-open-reconcile error:', error)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
