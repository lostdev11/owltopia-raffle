import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { listPartnerProgramApplications } from '@/lib/db/partner-program-applications'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session
    const applications = await listPartnerProgramApplications()
    return NextResponse.json({ applications })
  } catch (error) {
    console.error('[GET /api/admin/partner-applications]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
