import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  clearSiteMaintenance,
  endSiteMaintenanceEarly,
  evaluateMaintenanceWindow,
  getSiteMaintenance,
  setSiteMaintenanceWindow,
} from '@/lib/db/site-maintenance'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/site-maintenance
 * Full admin session. Returns row + derived flags for the dashboard.
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const row = await getSiteMaintenance()
    if (!row) {
      return NextResponse.json({ error: 'Maintenance config not found' }, { status: 500 })
    }
    const now = Date.now()
    const { publicActive, scheduled } = evaluateMaintenanceWindow(now, row.starts_at, row.ends_at)
    return NextResponse.json({ ...row, publicActive, scheduled })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/site-maintenance
 * Full admin session.
 * Body: { clear: true } | { end_early: true } | { starts_at: ISO string, ends_at: ISO string, message?: string | null }
 */
export async function PATCH(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))

    if (body.clear === true) {
      const row = await clearSiteMaintenance(session.wallet)
      if (!row) return NextResponse.json({ error: 'Could not clear maintenance' }, { status: 500 })
      const now = Date.now()
      const { publicActive, scheduled } = evaluateMaintenanceWindow(now, row.starts_at, row.ends_at)
      return NextResponse.json({ ...row, publicActive, scheduled })
    }

    if (body.end_early === true) {
      const current = await getSiteMaintenance()
      if (!current?.starts_at || !current?.ends_at) {
        return NextResponse.json({ error: 'No maintenance window configured' }, { status: 400 })
      }
      const nowMs = Date.now()
      const startMs = new Date(current.starts_at).getTime()
      const endMs = new Date(current.ends_at).getTime()
      const row =
        Number.isNaN(startMs) || Number.isNaN(endMs)
          ? await clearSiteMaintenance(session.wallet)
          : nowMs < startMs || nowMs >= endMs
            ? await clearSiteMaintenance(session.wallet)
            : await endSiteMaintenanceEarly(session.wallet)
      if (!row) return NextResponse.json({ error: 'Could not update maintenance' }, { status: 500 })
      const now = Date.now()
      const { publicActive, scheduled } = evaluateMaintenanceWindow(now, row.starts_at, row.ends_at)
      return NextResponse.json({ ...row, publicActive, scheduled })
    }

    const starts_at = typeof body.starts_at === 'string' ? body.starts_at : null
    const ends_at = typeof body.ends_at === 'string' ? body.ends_at : null
    if (!starts_at || !ends_at) {
      return NextResponse.json(
        { error: 'Provide starts_at and ends_at (ISO), or clear: true, or end_early: true' },
        { status: 400 }
      )
    }

    const message = body.message !== undefined ? (body.message == null ? null : String(body.message)) : undefined
    const row = await setSiteMaintenanceWindow({
      starts_at,
      ends_at,
      message,
      wallet: session.wallet,
    })
    if (!row) return NextResponse.json({ error: 'Could not save maintenance window' }, { status: 500 })
    const now = Date.now()
    const { publicActive, scheduled } = evaluateMaintenanceWindow(now, row.starts_at, row.ends_at)
    return NextResponse.json({ ...row, publicActive, scheduled })
  } catch (e) {
    const msg = safeErrorMessage(e)
    const status = msg.includes('Invalid') || msg.includes('End time') ? 400 : 500
    console.error(e)
    return NextResponse.json({ error: msg }, { status })
  }
}
