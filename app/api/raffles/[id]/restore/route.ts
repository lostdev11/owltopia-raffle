import { NextRequest, NextResponse } from 'next/server'
import { updateRaffle, getRaffleById } from '@/lib/db/raffles'
import { isAdmin } from '@/lib/db/admins'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/restore
 * Restore a raffle for outage recovery – extend end_time so tickets can be purchased again.
 * Use only when tickets couldn't be purchased due to site/database outage.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const body = await request.json().catch(() => ({}))
    const params = await context.params
    const raffleId = params.id

    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const walletAddress = body.wallet_address || request.headers.get('x-wallet-address')
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 401 }
      )
    }

    const adminStatus = await isAdmin(walletAddress)
    if (!adminStatus) {
      return NextResponse.json(
        { error: 'Only admins can restore raffles' },
        { status: 403 }
      )
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    // Only restore raffles that have ended and have no winner
    if (raffle.winner_wallet || raffle.winner_selected_at) {
      return NextResponse.json(
        { error: 'Cannot restore raffle: winner already selected' },
        { status: 400 }
      )
    }

    const endTimeToCheck = raffle.original_end_time ? new Date(raffle.original_end_time) : new Date(raffle.end_time)
    if (endTimeToCheck > new Date()) {
      return NextResponse.json(
        { error: 'Raffle has not ended yet. Use the normal edit form to update the raffle.' },
        { status: 400 }
      )
    }

    // Extend by 24 hours from now (outage recovery buffer)
    const extensionHours = body.extension_hours ?? 24
    const validHours = Math.min(168, Math.max(1, Number(extensionHours) || 24)) // 1–168 hours
    const newEndTime = new Date()
    newEndTime.setHours(newEndTime.getHours() + validHours)

    const originalEndTime = raffle.original_end_time || raffle.end_time

    await updateRaffle(raffleId, {
      original_end_time: originalEndTime,
      end_time: newEndTime.toISOString(),
      status: 'live',
      is_active: true,
    })

    const hoursLabel = validHours >= 168 ? '7 days' : validHours >= 72 ? '3 days' : `${validHours} hours`
    return NextResponse.json({
      success: true,
      message: `Raffle restored. End time extended by ${hoursLabel}. Tickets can now be purchased.`,
      raffleId,
      newEndTime: newEndTime.toISOString(),
    })
  } catch (error) {
    console.error('Error restoring raffle:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
