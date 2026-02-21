import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { getRafflesByCreator } from '@/lib/db/raffles'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/my-raffles
 * Returns raffles created by the current admin (session required).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const raffles = await getRafflesByCreator(session.wallet)
    return NextResponse.json(raffles)
  } catch (error) {
    console.error('Error fetching my raffles:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
