import { NextResponse } from 'next/server'
import { evaluateMaintenanceWindow, getSiteMaintenance } from '@/lib/db/site-maintenance'

export const dynamic = 'force-dynamic'

/**
 * Public: whether the scheduled maintenance window is active (for site banner).
 */
export async function GET() {
  try {
    const row = await getSiteMaintenance()
    if (!row) {
      return NextResponse.json({ active: false })
    }
    const now = Date.now()
    const { publicActive } = evaluateMaintenanceWindow(now, row.starts_at, row.ends_at)
    return NextResponse.json({
      active: publicActive,
      message: row.message,
      endsAt: row.ends_at,
    })
  } catch {
    return NextResponse.json({ active: false })
  }
}
