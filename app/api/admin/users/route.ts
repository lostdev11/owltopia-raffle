import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getAdminUsersAggregate } from '@/lib/db/admin-users'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/users
 * Returns aggregated user (wallet) stats for admin: raffles created, creator revenue, entries, spent.
 * Full admin only.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const users = await getAdminUsersAggregate()
    return NextResponse.json(users)
  } catch (error) {
    console.error('Admin users API error:', error)
    return NextResponse.json(
      { error: 'Failed to load users' },
      { status: 500 }
    )
  }
}
