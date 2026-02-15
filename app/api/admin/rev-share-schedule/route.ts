import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/db/admins'
import { getRevShareSchedule, updateRevShareSchedule } from '@/lib/db/rev-share-schedule'

export const dynamic = 'force-dynamic'

function getWallet(request: NextRequest): string | null {
  return request.headers.get('x-wallet-address') || request.nextUrl.searchParams.get('wallet') || null
}

/**
 * GET /api/admin/rev-share-schedule
 * Admin only. Returns current next rev share settings.
 */
export async function GET(request: NextRequest) {
  const wallet = getWallet(request)
  if (!wallet) return NextResponse.json({ error: 'Wallet required' }, { status: 401 })
  const admin = await isAdmin(wallet)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const schedule = await getRevShareSchedule()
    return NextResponse.json(schedule ?? { next_date: null, total_sol: null, total_usdc: null })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/rev-share-schedule
 * Admin only. Body: { next_date?: string | null, total_sol?: number | null, total_usdc?: number | null }
 */
export async function PATCH(request: NextRequest) {
  const wallet = getWallet(request)
  if (!wallet) return NextResponse.json({ error: 'Wallet required' }, { status: 401 })
  const admin = await isAdmin(wallet)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await request.json().catch(() => ({}))
    const next_date = body.next_date !== undefined ? (body.next_date == null ? null : String(body.next_date)) : undefined
    const total_sol = body.total_sol !== undefined ? (body.total_sol == null ? null : Number(body.total_sol)) : undefined
    const total_usdc = body.total_usdc !== undefined ? (body.total_usdc == null ? null : Number(body.total_usdc)) : undefined
    const updated = await updateRevShareSchedule({ next_date, total_sol, total_usdc })
    return NextResponse.json(updated ?? { next_date: null, total_sol: null, total_usdc: null })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  }
}
