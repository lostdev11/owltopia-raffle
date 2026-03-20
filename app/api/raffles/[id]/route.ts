import { NextRequest, NextResponse } from 'next/server'
import { updateRaffle, getRaffleById, getEntriesByRaffleId, deleteRaffle } from '@/lib/db/raffles'
import { requireAdminSession, requireFullAdminSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { isOwlEnabled } from '@/lib/tokens'
import { safeErrorMessage } from '@/lib/safe-error'
import { checkEscrowHoldsNft, transferNftPrizeToCreator } from '@/lib/raffles/prize-escrow'

// Force dynamic rendering since we use request body and params
export const dynamic = 'force-dynamic'

/** Public GET: fetch a single raffle by id (e.g. for live activity popup title). */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }
    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }
    return NextResponse.json(raffle, { status: 200 })
  } catch (err) {
    console.error('[GET /api/raffles/[id]]', err)
    return NextResponse.json({ error: 'Failed to load raffle' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json()
    const params = await context.params
    const raffleId = params.id
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    // Check if raffle exists
    const existingRaffle = await getRaffleById(raffleId)
    if (!existingRaffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    const role = await getAdminRole(session.wallet)
    const status = (existingRaffle.status ?? '').toLowerCase()
    const isDraft = status === 'draft'
    const isLiveLike = status === 'live' || status === 'ready_to_draw'

    // Validate currency: SOL, USDC, and OWL when enabled
    const validCurrencies = ['USDC', 'SOL', ...(isOwlEnabled() ? ['OWL'] : [])]
    if (body.currency && !validCurrencies.includes(body.currency)) {
      const message = body.currency === 'OWL' && !isOwlEnabled()
        ? 'OWL is not enabled on this server. Set NEXT_PUBLIC_OWL_MINT_ADDRESS in your environment to use OWL, or choose SOL or USDC.'
        : `Currency must be one of: ${validCurrencies.join(', ')}`
      return NextResponse.json(
        { error: message },
        { status: 400 }
      )
    }

    // Check if there are confirmed entries
    const entries = await getEntriesByRaffleId(raffleId)
    const hasConfirmedEntries = entries.some(e => e.status === 'confirmed')
    const requestedStartTime = body.start_time
    const requestedEndTime = body.end_time
    const isStartTimeChanged =
      requestedStartTime !== undefined && requestedStartTime !== existingRaffle.start_time
    const isEndTimeChanged =
      requestedEndTime !== undefined && requestedEndTime !== existingRaffle.end_time
    const isTimeEdit = isStartTimeChanged || isEndTimeChanged

    // Non-draft edits are restricted:
    // - raffle_creator: cannot edit non-draft raffles
    // - full admin: may edit time for live/ready_to_draw only when there are no confirmed entries
    if (!isDraft) {
      if (role !== 'full') {
        return NextResponse.json(
          { error: 'Only draft raffles can be edited' },
          { status: 403 }
        )
      }
      if (!isLiveLike || !isTimeEdit) {
        return NextResponse.json(
          { error: 'For non-draft raffles, full admins can only edit start/end time.' },
          { status: 403 }
        )
      }
      if (hasConfirmedEntries) {
        return NextResponse.json(
          { error: 'Cannot edit raffle time after confirmed tickets exist.' },
          { status: 400 }
        )
      }
    }

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

    // Parse min_tickets safely - default to minTickets if both minTickets and minParticipants exist
    let minTickets: number | null = null
    if (body.min_tickets != null && body.min_tickets !== '') {
      const parsed = typeof body.min_tickets === 'number' 
        ? body.min_tickets 
        : parseInt(String(body.min_tickets), 10)
      if (!isNaN(parsed) && parsed > 0) {
        minTickets = parsed
      } else if (body.min_tickets !== null && body.min_tickets !== '') {
        return NextResponse.json(
          { error: 'min_tickets must be a positive number' },
          { status: 400 }
        )
      }
    } else if (body.minParticipants != null && body.minParticipants !== '') {
      // Fallback to minParticipants if min_tickets not provided
      const parsed = typeof body.minParticipants === 'number' 
        ? body.minParticipants 
        : parseInt(String(body.minParticipants), 10)
      if (!isNaN(parsed) && parsed > 0) {
        minTickets = parsed
      } else if (body.minParticipants !== null && body.minParticipants !== '') {
        return NextResponse.json(
          { error: 'minParticipants must be a positive number' },
          { status: 400 }
        )
      }
    }

    // Validate dates if provided
    if (body.start_time || body.end_time) {
      const startTime = body.start_time || existingRaffle.start_time
      const endTime = body.end_time || existingRaffle.end_time

      const startDate = new Date(startTime)
      const endDate = new Date(endTime)
      
      if (isNaN(startDate.getTime())) {
        return NextResponse.json(
          { error: 'Invalid start_time format. Expected ISO 8601 format.' },
          { status: 400 }
        )
      }
      
      if (isNaN(endDate.getTime())) {
        return NextResponse.json(
          { error: 'Invalid end_time format. Expected ISO 8601 format.' },
          { status: 400 }
        )
      }
      
      // Validate that end_time is after start_time
      if (endDate <= startDate) {
        return NextResponse.json(
          { error: 'end_time must be after start_time' },
          { status: 400 }
        )
      }
      
      // Validate that raffle duration does not exceed 7 days (skip for extended raffles)
      if (!existingRaffle.original_end_time) {
        const durationMs = endDate.getTime() - startDate.getTime()
        const durationDays = durationMs / (1000 * 60 * 60 * 24)
        if (durationDays > 7) {
          return NextResponse.json(
            { error: 'Raffle duration cannot exceed 7 days' },
            { status: 400 }
          )
        }
      }
    }

    // Parse optional metadata fields
    const rank = body.rank !== undefined ? (body.rank && body.rank.trim() ? body.rank.trim() : null) : undefined
    const floorPrice = body.floor_price !== undefined ? (body.floor_price && body.floor_price.trim() ? body.floor_price.trim() : null) : undefined

    const updates: any = {
      title: body.title,
      description: body.description || null,
      image_url: body.image_url || null,
      ticket_price: body.ticket_price,
      currency: body.currency,
      max_tickets: maxTickets,
      min_tickets: minTickets,
      start_time: body.start_time,
      end_time: body.end_time,
      theme_accent: body.theme_accent,
    }

    // Only update rank and floor_price if explicitly provided
    if (rank !== undefined) {
      updates.rank = rank
    }
    if (floorPrice !== undefined) {
      updates.floor_price = floorPrice
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

    // Preserve Owl Vision integrity signal:
    // - any edit after confirmed entries
    // - any full-admin time edit on live/ready_to_draw raffles
    if (hasConfirmedEntries || (!isDraft && role === 'full' && isLiveLike && isTimeEdit)) {
      updates.edited_after_entries = true
    }

    // Update status if provided (valid values: draft, live, ready_to_draw, completed)
    const validStatuses = ['draft', 'live', 'ready_to_draw', 'completed']
    if (body.status !== undefined && validStatuses.includes(body.status)) {
      const isNftRaffle = existingRaffle.prize_type === 'nft'
      const isGoingLive =
        body.status === 'live' || body.status === 'ready_to_draw'
      if (isNftRaffle && isGoingLive && !existingRaffle.prize_deposited_at) {
        return NextResponse.json(
          {
            error:
              'NFT raffle cannot go live before prize escrow deposit is verified. Transfer NFT to escrow and click Verify deposit first.',
          },
          { status: 400 }
        )
      }
      updates.status = body.status
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
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const raffleId = params.id
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    // Check if raffle exists
    const existingRaffle = await getRaffleById(raffleId)
    if (!existingRaffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    const role = await getAdminRole(session.wallet)
    if (role === 'raffle_creator') {
      const wallet = session.wallet.trim()
      const createdBy = (existingRaffle.created_by ?? '').trim()
      const creatorWallet = (existingRaffle.creator_wallet ?? '').trim()
      const isCreator = createdBy === wallet || creatorWallet === wallet
      if (!isCreator) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      // Only draft raffles can be deleted by raffle_creator
      if ((existingRaffle.status ?? '').toLowerCase() !== 'draft') {
        return NextResponse.json(
          { error: 'Only draft raffles can be deleted' },
          { status: 403 }
        )
      }
    } else if (role === 'full') {
      // Full admin can delete any raffle (any status)
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let escrowCurrentlyHoldsPrize = false
    if (existingRaffle.prize_type === 'nft') {
      // Always check live escrow wallet state before deletion; DB flags can be stale.
      const escrowCheck = await checkEscrowHoldsNft(existingRaffle)
      if (!escrowCheck.holds && escrowCheck.error) {
        return NextResponse.json(
          {
            error: `Escrow wallet check failed. Verify escrow state before deleting: ${escrowCheck.error}`,
          },
          { status: 400 }
        )
      }
      escrowCurrentlyHoldsPrize = escrowCheck.holds
    }

    // Safety net: only require return when escrow wallet currently holds the NFT.
    // DB flags can be stale; live escrow state is authoritative.
    const requiresPrizeReturnBeforeDelete =
      existingRaffle.prize_type === 'nft' &&
      escrowCurrentlyHoldsPrize &&
      !existingRaffle.prize_returned_at &&
      !existingRaffle.nft_transfer_transaction
    if (requiresPrizeReturnBeforeDelete) {
      const returnResult = await transferNftPrizeToCreator(raffleId, 'cancelled')
      if (!returnResult.ok) {
        return NextResponse.json(
          {
            error: `Cannot delete raffle until NFT prize is returned to creator: ${returnResult.error ?? 'return failed'}`,
          },
          { status: 400 }
        )
      }
    }

    if (role === 'raffle_creator') {
      // Creator delete = soft delete so creators can review deleted raffles in dashboard history.
      const now = new Date().toISOString()
      await updateRaffle(raffleId, {
        status: 'cancelled',
        cancelled_at: now,
        is_active: false,
      })
      return NextResponse.json({ success: true, message: 'Raffle moved to deleted section' })
    }

    // Full admin delete = hard delete (entries cascade delete).
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
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
