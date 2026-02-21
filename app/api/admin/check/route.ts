import { NextRequest, NextResponse } from 'next/server'
import { getAdminRole } from '@/lib/db/admins'

// Force dynamic rendering since we use searchParams
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const raw = searchParams.get('wallet')
    const walletAddress = raw?.trim() ?? ''

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      )
    }

    const role = await getAdminRole(walletAddress)
    const isAdmin = role !== null

    return NextResponse.json({
      isAdmin,
      role: isAdmin ? role : undefined,
    })
  } catch (error) {
    console.error('Error checking admin status:', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
