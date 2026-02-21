import { NextRequest, NextResponse } from 'next/server'
import { getDeletedEntries } from '@/lib/db/entries'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    // Get optional raffle_id filter
    const raffleId = request.nextUrl.searchParams.get('raffle_id') || undefined

    // Fetch deleted entries
    const deletedEntries = await getDeletedEntries(raffleId)

    return NextResponse.json({ deletedEntries })
  } catch (error) {
    console.error('Error fetching deleted entries:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
