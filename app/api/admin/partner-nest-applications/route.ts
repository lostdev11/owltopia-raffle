import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { listPartnerNestApplicationsAdmin } from '@/lib/db/partner-nest-applications'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/partner-nest-applications — all partner Nesting requests.
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const applications = await listPartnerNestApplicationsAdmin()
    return NextResponse.json({ applications })
  } catch (e) {
    console.error('[admin/partner-nest-applications GET]', e)
    const msg = safeErrorMessage(e)
    if (msg.toLowerCase().includes('partner_nest_applications') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Table missing. Run migration 205_partner_nest_applications.sql.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
