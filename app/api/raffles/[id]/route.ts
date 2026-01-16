import { NextRequest, NextResponse } from 'next/server'
import { updateRaffle, getRaffleById, getEntriesByRaffleId, deleteRaffle } from '@/lib/db/raffles'
import { isAdmin } from '@/lib/db/admins'

// Force dynamic rendering since we use request body and params
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const raffleId = params.id

    // Check if wallet address is provided
    const walletAddress = body.wallet_address || request.headers.get('x-wallet-address')
    
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
        { error: 'Only admins can update raffles' },
        { status: 403 }
      )
    }

    // Check if raffle exists
    const existingRaffle = await getRaffleById(raffleId)
    if (!existingRaffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    // Validate currency is USDC or SOL only
    const validCurrencies = ['USDC', 'SOL']
    if (body.currency && !validCurrencies.includes(body.currency)) {
      return NextResponse.json(
        { error: 'Currency must be either USDC or SOL' },
        { status: 400 }
      )
    }

    // Check if there are confirmed entries
    const entries = await getEntriesByRaffleId(raffleId)
    const hasConfirmedEntries = entries.some(e => e.status === 'confirmed')

    // Parse max_tickets safely
    let maxTickets: number | null = null
    if (body.max_tickets != null && body.max_tickets !== '') {
      const parsed = typeof body.max_tickets === 'number' 
        ? body.max_tickets 
        : parseInt(String(body.max_tickets), 10)
      if (!isNaN(parsed) && parsed > 0) {
        maxTickets = parsed
      } else if (body.max_tickets !== null && body.max_tickets !== '') {
        return NextResponse.json(
          { error: 'max_tickets must be a positive number' },
          { status: 400 }
        )
      }
    }

    const updates: any = {
      title: body.title,
      description: body.description || null,
      image_url: body.image_url || null,
      ticket_price: body.ticket_price,
      currency: body.currency,
      max_tickets: maxTickets,
      start_time: body.start_time,
      end_time: body.end_time,
      theme_accent: body.theme_accent,
    }

    // Only update prize_amount and prize_currency if explicitly provided
    // This prevents violating the constraint if prize_type is 'crypto'
    if (body.prize_amount !== undefined) {
      updates.prize_amount = body.prize_amount
    }
    if (body.prize_currency !== undefined) {
      updates.prize_currency = body.prize_currency
    }
    if (body.prize_type !== undefined) {
      updates.prize_type = body.prize_type
    }

    // Set edited_after_entries if there are confirmed entries
    if (hasConfirmedEntries) {
      updates.edited_after_entries = true
    }

    const raffle = await updateRaffle(raffleId, updates)

    if (!raffle) {
      return NextResponse.json(
        { error: 'Failed to update raffle' },
        { status: 500 }
      )
    }

    return NextResponse.json(raffle)
  } catch (error) {
    console.error('Error updating raffle:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const raffleId = params.id

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
        { error: 'Only admins can delete raffles' },
        { status: 403 }
      )
    }

    // Check if raffle exists
    const existingRaffle = await getRaffleById(raffleId)
    if (!existingRaffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    // Delete the raffle (entries will be cascade deleted)
    const success = await deleteRaffle(raffleId)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to delete raffle' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, message: 'Raffle deleted successfully' })
  } catch (error) {
    console.error('Error deleting raffle:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
