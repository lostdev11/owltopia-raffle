import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getCreatorHealthRows } from '@/lib/db/creator-health'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/creator-health
 * Per-creator platform health signals for full admins.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const creators = await getCreatorHealthRows()
    return NextResponse.json({ creators })
  } catch (error) {
    console.error('Admin creator-health API error:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
