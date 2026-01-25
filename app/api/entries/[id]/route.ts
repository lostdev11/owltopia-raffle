import { NextRequest, NextResponse } from 'next/server'
import { deleteEntry, getEntryById } from '@/lib/db/entries'
import { isAdmin } from '@/lib/db/admins'

// Force dynamic rendering since we use request body and params
export const dynamic = 'force-dynamic'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const entryId = params.id

    // Check if wallet address is provided (from header or body)
    let walletAddress = request.headers.get('x-wallet-address')
    
    if (!walletAddress) {
      try {
        const body = await request.json()
        walletAddress = body.wallet_address
      } catch {
        // Body might be empty or invalid, that's okay
      }
    }

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
        { error: 'Only admins can delete entries' },
        { status: 403 }
      )
    }

    // Check if entry exists
    const existingEntry = await getEntryById(entryId)
    if (!existingEntry) {
      return NextResponse.json(
        { error: 'Entry not found' },
        { status: 404 }
      )
    }

    // Delete the entry (pass wallet address for audit trail)
    const success = await deleteEntry(entryId, walletAddress)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to delete entry' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, message: 'Entry deleted successfully' })
  } catch (error) {
    console.error('Error deleting entry:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
