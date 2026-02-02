import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/db/admins'

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

    const adminStatus = await isAdmin(walletAddress)

    return NextResponse.json({ isAdmin: adminStatus })
  } catch (error) {
    console.error('Error checking admin status:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
