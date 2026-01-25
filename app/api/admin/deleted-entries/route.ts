import { NextRequest, NextResponse } from 'next/server'
import { getDeletedEntries } from '@/lib/db/entries'
import { isAdmin } from '@/lib/db/admins'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Get wallet address from query params or header
    const walletAddress = request.headers.get('x-wallet-address') || 
                         request.nextUrl.searchParams.get('wallet')

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 401 }
      )
    }

    // Check if user is an admin
    const adminStatus = await isAdmin(walletAddress)
    if (!adminStatus) {
      return NextResponse.json(
        { error: 'Only admins can view deleted entries' },
        { status: 403 }
      )
    }

    // Get optional raffle_id filter
    const raffleId = request.nextUrl.searchParams.get('raffle_id') || undefined

    // Fetch deleted entries
    const deletedEntries = await getDeletedEntries(raffleId)

    return NextResponse.json({ deletedEntries })
  } catch (error) {
    console.error('Error fetching deleted entries:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
