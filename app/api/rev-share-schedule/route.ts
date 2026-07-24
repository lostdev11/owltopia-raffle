import { NextResponse } from 'next/server'
import { getRevShareSchedule } from '@/lib/db/rev-share-schedule'

export const dynamic = 'force-dynamic'

/**
 * GET /api/rev-share-schedule
 * Public. Returns the founder-set next rev share date and Gen1/Gen2 totals for the homepage.
 */
export async function GET() {
  try {
    const schedule = await getRevShareSchedule()
    if (!schedule) {
      return NextResponse.json({
        next_date: null,
        gen1_next_date: null,
        gen2_next_date: null,
        total_sol: null,
        total_usdc: null,
        gen1_total_sol: null,
        gen1_total_usdc: null,
        gen2_total_sol: null,
        gen2_total_usdc: null,
      })
    }
    return NextResponse.json({
      next_date: schedule.next_date,
      gen1_next_date: schedule.gen1_next_date,
      gen2_next_date: schedule.gen2_next_date,
      total_sol: schedule.total_sol,
      total_usdc: schedule.total_usdc,
      gen1_total_sol: schedule.gen1_total_sol,
      gen1_total_usdc: schedule.gen1_total_usdc,
      gen2_total_sol: schedule.gen2_total_sol,
      gen2_total_usdc: schedule.gen2_total_usdc,
    })
  } catch (error) {
    console.error('Error fetching rev share schedule:', error)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}
