import { NextResponse } from 'next/server'
import { getRevShareSchedule } from '@/lib/db/rev-share-schedule'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rev-share-schedule
 * Public. Returns the founder-set next rev share date and total SOL/USDC to be shared.
 */
export async function GET() {
  try {
    const schedule = await getRevShareSchedule()
    if (!schedule) return NextResponse.json({ next_date: null, total_sol: null, total_usdc: null })
    return NextResponse.json({
      next_date: schedule.next_date,
      total_sol: schedule.total_sol,
      total_usdc: schedule.total_usdc,
    })
  } catch (error) {
    console.error('Error fetching rev share schedule:', error)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}
