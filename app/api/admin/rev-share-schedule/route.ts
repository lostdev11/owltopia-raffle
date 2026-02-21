import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getRevShareSchedule, updateRevShareSchedule } from '@/lib/db/rev-share-schedule'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/rev-share-schedule
 * Admin only (session required).
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const schedule = await getRevShareSchedule()
    return NextResponse.json(schedule ?? { next_date: null, total_sol: null, total_usdc: null })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/rev-share-schedule
 * Admin only (session required). Body: { next_date?, total_sol?, total_usdc? }
 */
export async function PATCH(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    const next_date = body.next_date !== undefined ? (body.next_date == null ? null : String(body.next_date)) : undefined
    const total_sol = body.total_sol !== undefined ? (body.total_sol == null ? null : Number(body.total_sol)) : undefined
    const total_usdc = body.total_usdc !== undefined ? (body.total_usdc == null ? null : Number(body.total_usdc)) : undefined
    const updated = await updateRevShareSchedule({ next_date, total_sol, total_usdc })
    return NextResponse.json(updated ?? { next_date: null, total_sol: null, total_usdc: null })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
