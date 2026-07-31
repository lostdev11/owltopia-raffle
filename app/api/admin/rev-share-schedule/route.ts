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
    return NextResponse.json(
      schedule ?? {
        next_date: null,
        gen1_next_date: null,
        gen2_next_date: null,
        total_sol: null,
        total_usdc: null,
      }
    )
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/rev-share-schedule
 * Admin only (session required). Body: { next_date?, gen1_next_date?, gen2_next_date?, total_sol?, total_usdc?, gen*_total_*? }
 */
export async function PATCH(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    const next_date = body.next_date !== undefined ? (body.next_date == null ? null : String(body.next_date)) : undefined
    const gen1_next_date =
      body.gen1_next_date !== undefined ? (body.gen1_next_date == null ? null : String(body.gen1_next_date)) : undefined
    const gen2_next_date =
      body.gen2_next_date !== undefined ? (body.gen2_next_date == null ? null : String(body.gen2_next_date)) : undefined
    const total_sol = body.total_sol !== undefined ? (body.total_sol == null ? null : Number(body.total_sol)) : undefined
    const total_usdc =
      body.total_usdc !== undefined ? (body.total_usdc == null ? null : Number(body.total_usdc)) : undefined
    const gen1_total_sol =
      body.gen1_total_sol !== undefined ? (body.gen1_total_sol == null ? null : Number(body.gen1_total_sol)) : undefined
    const gen1_total_usdc =
      body.gen1_total_usdc !== undefined ? (body.gen1_total_usdc == null ? null : Number(body.gen1_total_usdc)) : undefined
    const gen2_total_sol =
      body.gen2_total_sol !== undefined ? (body.gen2_total_sol == null ? null : Number(body.gen2_total_sol)) : undefined
    const gen2_total_usdc =
      body.gen2_total_usdc !== undefined ? (body.gen2_total_usdc == null ? null : Number(body.gen2_total_usdc)) : undefined
    const claims_enabled =
      body.claims_enabled !== undefined ? Boolean(body.claims_enabled) : undefined

    // Keep legacy next_date in sync with Gen 1 when Gen 1 date is saved and next_date was not sent.
    const resolvedNextDate =
      next_date !== undefined ? next_date : gen1_next_date !== undefined ? gen1_next_date : undefined

    // Homepage schedule is display-only. Claimable period totals are credited only by verified
    // deposits into the rev-share pool (POST /api/admin/gen-owl-rev-share/deposit).
    const updated = await updateRevShareSchedule({
      next_date: resolvedNextDate,
      gen1_next_date,
      gen2_next_date,
      total_sol,
      total_usdc,
      gen1_total_sol,
      gen1_total_usdc,
      gen2_total_sol,
      gen2_total_usdc,
      claims_enabled,
    })

    return NextResponse.json(
      updated ?? {
        next_date: null,
        gen1_next_date: null,
        gen2_next_date: null,
        total_sol: null,
        total_usdc: null,
      }
    )
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
