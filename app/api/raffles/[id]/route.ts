import { NextRequest, NextResponse } from 'next/server'
import { updateRaffle, getRaffleById, getEntriesByRaffleId, deleteRaffle } from '@/lib/db/raffles'
import type { Raffle } from '@/lib/types'
import { requireAdminSession, requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import {
  checkEscrowHoldsNft,
  checkEscrowHoldsPartnerSplPrize,
  transferNftPrizeToCreator,
  transferPartnerSplPrizeToCreator,
} from '@/lib/raffles/prize-escrow'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import {
  ADMIN_HARD_DELETE_REASON_MAX_CHARS,
  ADMIN_HARD_DELETE_REASON_MIN_CHARS,
  recordRaffleAdminDeletion,
} from '@/lib/raffles/admin-hard-delete'
import {
  parseNftFloorPrice,
  parseNftTicketPrice,
  computeNftMinTicketsFromFloorAndTicket,
  validateNftMaxTickets,
  validateNftMinTicketsNotOverCap,
} from '@/lib/raffles/nft-raffle-economics'

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
    const prizeReturnRecorded =
      !!existingRaffle.prize_returned_at &&
      !!(existingRaffle.prize_return_tx ?? '').trim()

    const bodyKeys = Object.keys(body).filter(
      (k) => k !== 'wallet_address' && (body as Record<string, unknown>)[k] !== undefined
    )
    const isImageFallbackOnlyPatch =
      bodyKeys.length === 1 && bodyKeys[0] === 'image_fallback_url'

    if (isImageFallbackOnlyPatch) {
      const raw = body.image_fallback_url
      let image_fallback_url: string | null
      if (raw === null || raw === '') {
        image_fallback_url = null
      } else if (typeof raw === 'string') {
        const t = raw.trim()
        if (!t) {
          image_fallback_url = null
        } else if (t.length > 2048) {
          return NextResponse.json(
            { error: 'image_fallback_url must be at most 2048 characters' },
            { status: 400 }
          )
        } else {
          image_fallback_url = t
        }
      } else {
        return NextResponse.json(
          { error: 'image_fallback_url must be a string, null, or empty' },
          { status: 400 }
        )
      }
      const raffle = await updateRaffle(raffleId, { image_fallback_url })
      if (!raffle) {
        return NextResponse.json({ error: 'Failed to update raffle' }, { status: 500 })
      }
      return NextResponse.json(raffle)
    }

    /**
     * Full admin: void an erroneous winner selection (DB only). Only when the NFT was never sent to the
     * winner and creator has not claimed funds escrow proceeds. Requires a new future end_time and live/ready_to_draw.
     */
    if (body.void_winner_admin_override === true) {
      if (body.confirm_void_winner !== true) {
        return NextResponse.json(
          { error: 'You must set confirm_void_winner: true to void a winner.' },
          { status: 400 }
        )
      }
      const hasWinner =
        !!(existingRaffle.winner_wallet ?? '').trim() || !!existingRaffle.winner_selected_at
      if (!hasWinner) {
        return NextResponse.json(
          { error: 'This raffle has no winner to void.' },
          { status: 400 }
        )
      }
      if (prizeReturnRecorded) {
        return NextResponse.json(
          {
            error:
              'Cannot void winner: prize was returned to the creator. Resolve escrow separately before reopening.',
          },
          { status: 400 }
        )
      }
      if ((existingRaffle.nft_transfer_transaction ?? '').trim()) {
        return NextResponse.json(
          {
            error:
              'Cannot void winner: NFT prize transfer to the winner is already recorded (on-chain). This cannot be undone from the app.',
          },
          { status: 400 }
        )
      }
      if (existingRaffle.creator_claimed_at) {
        return NextResponse.json(
          {
            error:
              'Cannot void winner: creator already claimed proceeds from funds escrow.',
          },
          { status: 400 }
        )
      }
      if ((existingRaffle.creator_funds_claim_locked_at ?? '').trim()) {
        return NextResponse.json(
          { error: 'Cannot void winner: a funds claim is in progress. Wait and retry, or clear the lock out-of-band.' },
          { status: 423 }
        )
      }

      const endRaw = body.end_time
      if (!endRaw || typeof endRaw !== 'string') {
        return NextResponse.json(
          { error: 'end_time is required (ISO 8601) when voiding a winner.' },
          { status: 400 }
        )
      }
      const endDate = new Date(endRaw)
      if (isNaN(endDate.getTime())) {
        return NextResponse.json({ error: 'Invalid end_time.' }, { status: 400 })
      }
      const now = new Date()
      if (endDate <= now) {
        return NextResponse.json(
          { error: 'end_time must be in the future.' },
          { status: 400 }
        )
      }

      const nextStatusRaw = body.status
      const nextStatus =
        nextStatusRaw === 'ready_to_draw'
          ? 'ready_to_draw'
          : nextStatusRaw === 'live' || nextStatusRaw === undefined
            ? 'live'
            : null
      if (nextStatus === null) {
        return NextResponse.json(
          { error: 'status must be live or ready_to_draw when set.' },
          { status: 400 }
        )
      }

      const isNftRaffle = existingRaffle.prize_type === 'nft'
      if (
        isNftRaffle &&
        (nextStatus === 'live' || nextStatus === 'ready_to_draw') &&
        !existingRaffle.prize_deposited_at
      ) {
        return NextResponse.json(
          {
            error:
              'NFT raffle cannot be live/ready_to_draw before prize escrow deposit is verified.',
          },
          { status: 400 }
        )
      }

      const startMs = new Date(existingRaffle.start_time).getTime()
      if (!Number.isNaN(startMs) && endDate.getTime() <= startMs) {
        return NextResponse.json(
          { error: 'end_time must be after start_time.' },
          { status: 400 }
        )
      }

      const patch: Record<string, unknown> = {
        winner_wallet: null,
        winner_selected_at: null,
        settled_at: null,
        fee_bps_applied: null,
        fee_tier_reason: null,
        platform_fee_amount: null,
        creator_payout_amount: null,
        nft_claim_locked_at: null,
        nft_claim_locked_wallet: null,
        creator_claimed_at: null,
        creator_claim_tx: null,
        creator_funds_claim_locked_at: null,
        end_time: endDate.toISOString(),
        status: nextStatus,
        edited_after_entries: true,
        updated_at: now.toISOString(),
      }

      if (nextStatus === 'live') {
        patch.is_active = true
      }

      console.info('[Raffle void winner admin override]', {
        raffleId,
        wallet: session.wallet,
        priorWinner: existingRaffle.winner_wallet,
        priorStatus: existingRaffle.status,
        end_time: patch.end_time,
        nextStatus,
      })

      const raffle = await updateRaffle(
        raffleId,
        patch as Partial<Raffle> & { edited_after_entries?: boolean }
      )
      if (!raffle) {
        return NextResponse.json({ error: 'Failed to update raffle' }, { status: 500 })
      }
      return NextResponse.json(raffle)
    }

    /** Full admin: push end_time into the future and return a listing to live/ready_to_draw (no winner yet). */
    if (body.raffle_deadline_admin_override === true) {
      const endRaw = body.end_time
      if (!endRaw || typeof endRaw !== 'string') {
        return NextResponse.json(
          { error: 'end_time is required (ISO 8601).' },
          { status: 400 }
        )
      }
      const endDate = new Date(endRaw)
      if (isNaN(endDate.getTime())) {
        return NextResponse.json({ error: 'Invalid end_time.' }, { status: 400 })
      }
      const now = new Date()
      if (endDate <= now) {
        return NextResponse.json(
          { error: 'end_time must be in the future.' },
          { status: 400 }
        )
      }
      if (existingRaffle.winner_wallet || existingRaffle.winner_selected_at) {
        return NextResponse.json(
          { error: 'Cannot reopen a raffle that already has a winner.' },
          { status: 400 }
        )
      }
      if (prizeReturnRecorded) {
        return NextResponse.json(
          {
            error:
              'Prize was returned to the creator; reopen only after a new escrow deposit if applicable.',
          },
          { status: 400 }
        )
      }

      const curStatus = (existingRaffle.status ?? '').toLowerCase()
      const allowedFrom = [
        'live',
        'ready_to_draw',
        'pending_min_not_met',
        'failed_refund_available',
        'cancelled',
        'completed',
      ]
      if (!allowedFrom.includes(curStatus)) {
        return NextResponse.json(
          {
            error: `Deadline override / restore is not allowed from status "${existingRaffle.status}".`,
          },
          { status: 400 }
        )
      }

      const nextStatusRaw = body.status
      const nextStatus =
        nextStatusRaw === 'ready_to_draw'
          ? 'ready_to_draw'
          : nextStatusRaw === 'live' || nextStatusRaw === undefined
            ? 'live'
            : null
      if (nextStatus === null) {
        return NextResponse.json(
          { error: 'status must be live or ready_to_draw when set.' },
          { status: 400 }
        )
      }

      const isNftRaffle = existingRaffle.prize_type === 'nft'
      if (
        isNftRaffle &&
        (nextStatus === 'live' || nextStatus === 'ready_to_draw') &&
        !existingRaffle.prize_deposited_at
      ) {
        return NextResponse.json(
          {
            error:
              'NFT raffle cannot be live/ready_to_draw before prize escrow deposit is verified.',
          },
          { status: 400 }
        )
      }

      const startMs = new Date(existingRaffle.start_time).getTime()
      if (!Number.isNaN(startMs) && endDate.getTime() <= startMs) {
        return NextResponse.json(
          { error: 'end_time must be after start_time.' },
          { status: 400 }
        )
      }

      const patch: Record<string, unknown> = {
        end_time: endDate.toISOString(),
        status: nextStatus,
        edited_after_entries: true,
        updated_at: now.toISOString(),
      }

      if (curStatus === 'cancelled') {
        patch.cancelled_at = null
        patch.cancellation_requested_at = null
        patch.cancellation_fee_amount = null
        patch.cancellation_fee_currency = null
        patch.cancellation_refund_policy = null
        patch.cancellation_fee_paid_at = null
        patch.cancellation_fee_payment_tx = null
      }

      if (nextStatus === 'live') {
        patch.is_active = true
      }

      if (body.time_extension_count !== undefined) {
        const n =
          typeof body.time_extension_count === 'number'
            ? body.time_extension_count
            : parseInt(String(body.time_extension_count), 10)
        if (isNaN(n) || n < 0 || n > 10) {
          return NextResponse.json(
            { error: 'time_extension_count must be an integer from 0 to 10.' },
            { status: 400 }
          )
        }
        patch.time_extension_count = n
      }

      if (
        body.original_end_time !== undefined &&
        body.original_end_time !== null &&
        String(body.original_end_time).trim() !== ''
      ) {
        const o = new Date(String(body.original_end_time))
        if (isNaN(o.getTime())) {
          return NextResponse.json({ error: 'Invalid original_end_time.' }, { status: 400 })
        }
        patch.original_end_time = o.toISOString()
      }

      console.info('[Raffle deadline admin override]', {
        raffleId,
        wallet: session.wallet,
        fromStatus: existingRaffle.status,
        end_time: patch.end_time,
        status: nextStatus,
        time_extension_count: patch.time_extension_count,
      })

      const raffle = await updateRaffle(
        raffleId,
        patch as Partial<Raffle> & { edited_after_entries?: boolean }
      )
      if (!raffle) {
        return NextResponse.json({ error: 'Failed to update raffle' }, { status: 500 })
      }
      return NextResponse.json(raffle)
    }

    const status = (existingRaffle.status ?? '').toLowerCase()
    const isDraft = status === 'draft'
    const isLiveLike = status === 'live' || status === 'ready_to_draw'
    const isNft = existingRaffle.prize_type === 'nft'

    // Ticket currency: SOL or USDC only
    const validCurrencies = ['USDC', 'SOL']
    const requestedCurrency =
      typeof body.currency === 'string' && body.currency.trim()
        ? body.currency.trim().toUpperCase()
        : ''
    if (requestedCurrency && !validCurrencies.includes(requestedCurrency)) {
      return NextResponse.json(
        { error: `Currency must be one of: ${validCurrencies.join(', ')}` },
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

    const isNftEconomicsAdminOverride =
      isNft && body.nft_economics_admin_override === true

    // Non-draft edits are restricted:
    // - may edit time for live/ready_to_draw only when there are no confirmed entries
    // - may override NFT floor/ticket/min/max on active NFT raffles (nft_economics_admin_override)
    if (!isDraft) {
      if (isNftEconomicsAdminOverride) {
        const st = (existingRaffle.status ?? '').toLowerCase()
        const allowedNftEconomicsStatuses = [
          'live',
          'ready_to_draw',
          'pending_min_not_met',
          'failed_refund_available',
          'cancelled',
          'completed',
        ]
        if (!allowedNftEconomicsStatuses.includes(st)) {
          return NextResponse.json(
            {
              error:
                'NFT economics override is only allowed for live / ready_to_draw / pending_min_not_met / failed_refund_available / cancelled, or completed (no winner).',
            },
            { status: 400 }
          )
        }
      } else if (!isLiveLike || !isTimeEdit) {
        return NextResponse.json(
          { error: 'For non-draft raffles, full admins can only edit start/end time.' },
          { status: 403 }
        )
      } else if (hasConfirmedEntries) {
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

    const minTicketsInBody =
      (body.min_tickets !== undefined && body.min_tickets !== '') ||
      (body.minParticipants !== undefined && body.minParticipants !== '')

    const updates: Record<string, unknown> = {
      title: body.title,
      description:
        body.description !== undefined ? (body.description || null) : undefined,
      ticket_price: body.ticket_price,
      currency:
        body.currency === undefined
          ? undefined
          : typeof body.currency === 'string' && body.currency.trim()
            ? body.currency.trim().toUpperCase()
            : body.currency,
      max_tickets: body.max_tickets !== undefined ? maxTickets : undefined,
      min_tickets: minTicketsInBody ? minTickets : undefined,
      start_time: body.start_time,
      end_time: body.end_time,
      theme_accent: body.theme_accent,
    }

    if (isDraft && body.image_fallback_url !== undefined) {
      const rawFb = body.image_fallback_url
      if (rawFb === null || rawFb === '') {
        updates.image_fallback_url = null
      } else if (typeof rawFb === 'string') {
        const t = rawFb.trim()
        if (!t) {
          updates.image_fallback_url = null
        } else if (t.length > 2048) {
          return NextResponse.json(
            { error: 'image_fallback_url must be at most 2048 characters' },
            { status: 400 }
          )
        } else {
          updates.image_fallback_url = t
        }
      } else {
        return NextResponse.json(
          { error: 'image_fallback_url must be a string, null, or empty' },
          { status: 400 }
        )
      }
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
    // - any time edit on live/ready_to_draw raffles
    if (hasConfirmedEntries || (!isDraft && isLiveLike && isTimeEdit)) {
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

    if (isNft) {
      updates.prize_amount = null
      updates.prize_currency = null
      // NFT ticket economics are fixed after draft: only new raffles get recomputed floor/ticket/min at edit time.
      if (!isDraft) {
        if (isNftEconomicsAdminOverride) {
          if (existingRaffle.winner_wallet || existingRaffle.winner_selected_at) {
            return NextResponse.json(
              { error: 'Cannot change NFT economics after a winner is selected.' },
              { status: 400 }
            )
          }
          const touched =
            body.min_tickets !== undefined ||
            body.floor_price !== undefined ||
            body.ticket_price !== undefined ||
            body.max_tickets !== undefined ||
            (body.currency !== undefined && String(body.currency ?? '').trim() !== '')
          if (!touched) {
            return NextResponse.json(
              {
                error:
                  'Provide at least one of: min_tickets, floor_price, ticket_price, max_tickets, or currency.',
              },
              { status: 400 }
            )
          }

          const nextFloorStr =
            body.floor_price !== undefined
              ? String(body.floor_price ?? '').trim() || null
              : existingRaffle.floor_price

          const nextTicketRaw =
            body.ticket_price !== undefined ? body.ticket_price : existingRaffle.ticket_price

          let nextMinTickets: number | null = existingRaffle.min_tickets
          if (body.min_tickets != null && body.min_tickets !== '') {
            const p =
              typeof body.min_tickets === 'number'
                ? body.min_tickets
                : parseInt(String(body.min_tickets), 10)
            if (isNaN(p) || p <= 0) {
              return NextResponse.json(
                { error: 'min_tickets must be a positive integer' },
                { status: 400 }
              )
            }
            nextMinTickets = p
          }

          const fp = parseNftFloorPrice(nextFloorStr)
          if (!fp.ok) {
            return NextResponse.json({ error: fp.error }, { status: 400 })
          }
          const tp = parseNftTicketPrice(nextTicketRaw)
          if (!tp.ok) {
            return NextResponse.json({ error: tp.error }, { status: 400 })
          }

          const computedMin = computeNftMinTicketsFromFloorAndTicket(fp.value, tp.value)
          if (nextMinTickets == null || !Number.isFinite(nextMinTickets) || nextMinTickets <= 0) {
            nextMinTickets = computedMin
          }

          const capOk = validateNftMinTicketsNotOverCap(nextMinTickets)
          if (!capOk.ok) {
            return NextResponse.json({ error: capOk.error }, { status: 400 })
          }

          const effectiveMinForMax = Math.max(nextMinTickets, computedMin)

          let nextMaxTickets: number | null = existingRaffle.max_tickets
          if (body.max_tickets !== undefined) {
            if (body.max_tickets === null || body.max_tickets === '') {
              nextMaxTickets = null
            } else {
              const parsed =
                typeof body.max_tickets === 'number'
                  ? body.max_tickets
                  : parseInt(String(body.max_tickets), 10)
              if (isNaN(parsed) || parsed <= 0) {
                return NextResponse.json(
                  { error: 'max_tickets must be a positive integer when set' },
                  { status: 400 }
                )
              }
              nextMaxTickets = parsed
            }
          }

          const maxOk = validateNftMaxTickets(nextMaxTickets, effectiveMinForMax)
          if (!maxOk.ok) {
            return NextResponse.json({ error: maxOk.error }, { status: 400 })
          }

          if (body.currency !== undefined && String(body.currency ?? '').trim() !== '') {
            const cur = String(body.currency).trim().toUpperCase()
            if (!validCurrencies.includes(cur)) {
              return NextResponse.json(
                {
                  error: `Currency must be one of: ${validCurrencies.join(', ')}`,
                },
                { status: 400 }
              )
            }
            updates.currency = cur
          }

          updates.floor_price = fp.string
          updates.ticket_price = tp.value
          updates.min_tickets = nextMinTickets
          updates.max_tickets = nextMaxTickets

          console.info('[NFT economics admin override]', {
            raffleId,
            wallet: session.wallet,
            min_tickets: nextMinTickets,
            floor_price: fp.string,
            ticket_price: tp.value,
            max_tickets: nextMaxTickets,
          })
        } else {
          updates.floor_price = existingRaffle.floor_price
          updates.ticket_price = existingRaffle.ticket_price
          updates.min_tickets = existingRaffle.min_tickets
          updates.max_tickets = existingRaffle.max_tickets
          updates.currency = existingRaffle.currency
        }
      } else {
        const rawFloor =
          body.floor_price !== undefined &&
          body.floor_price !== null &&
          String(body.floor_price).trim()
            ? String(body.floor_price).trim()
            : existingRaffle.floor_price
        const fp = parseNftFloorPrice(rawFloor)
        if (!fp.ok) {
          return NextResponse.json({ error: fp.error }, { status: 400 })
        }
        const ticketRaw =
          body.ticket_price !== undefined ? body.ticket_price : existingRaffle.ticket_price
        const tp = parseNftTicketPrice(ticketRaw)
        if (!tp.ok) {
          return NextResponse.json({ error: tp.error }, { status: 400 })
        }
        const minTickets = computeNftMinTicketsFromFloorAndTicket(fp.value, tp.value)
        const capOk = validateNftMinTicketsNotOverCap(minTickets)
        if (!capOk.ok) {
          return NextResponse.json({ error: capOk.error }, { status: 400 })
        }
        const maxOk = validateNftMaxTickets(maxTickets, minTickets)
        if (!maxOk.ok) {
          return NextResponse.json({ error: maxOk.error }, { status: 400 })
        }
        updates.min_tickets = minTickets
        updates.ticket_price = tp.value
        updates.floor_price = fp.string
      }
    }

    let raffle: Raffle
    try {
      raffle = await updateRaffle(
        raffleId,
        updates as Partial<Raffle> & { edited_after_entries?: boolean }
      )
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      if (raw.includes('raffles_nft_min_tickets_fixed')) {
        return NextResponse.json(
          {
            error:
              'The database still enforces NFT min_tickets = 50 (old migration). In Supabase SQL Editor, run migration 054_ensure_drop_nft_fixed_min_tickets_constraints.sql (or 051_drop_nft_fixed_min_tickets_checks.sql), then try again.',
          },
          { status: 409 }
        )
      }
      if (raw.includes('raffles_nft_max_tickets_minimum')) {
        return NextResponse.json(
          {
            error:
              'The database rejected max_tickets (legacy NFT rule). Run migration 054_ensure_drop_nft_fixed_min_tickets_constraints.sql in Supabase, then try again.',
          },
          { status: 409 }
        )
      }
      throw err
    }

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

    let deleteReasonParsed: string | undefined
    try {
      const raw = await request.json()
      if (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).delete_reason === 'string') {
        deleteReasonParsed = String((raw as Record<string, unknown>).delete_reason).trim()
      }
    } catch {
      // No JSON body (or empty)
    }

    // Check if raffle exists
    const existingRaffle = await getRaffleById(raffleId)
    if (!existingRaffle) {
      return NextResponse.json(
        { error: 'Raffle not found' },
        { status: 404 }
      )
    }

    if (
      !deleteReasonParsed ||
      deleteReasonParsed.length < ADMIN_HARD_DELETE_REASON_MIN_CHARS ||
      deleteReasonParsed.length > ADMIN_HARD_DELETE_REASON_MAX_CHARS
    ) {
      return NextResponse.json(
        {
          error: `Admin delete requires delete_reason (${ADMIN_HARD_DELETE_REASON_MIN_CHARS}–${ADMIN_HARD_DELETE_REASON_MAX_CHARS} characters).`,
        },
        { status: 400 }
      )
    }

    let escrowCurrentlyHoldsPrize = false
    if (existingRaffle.prize_type === 'nft') {
      // Live chain check; DB flags can be stale. Empty escrow is OK if the prize was never
      // verified deposited, or was already returned / claimed (no longer expected in escrow).
      const escrowCheck = await checkEscrowHoldsNft(existingRaffle)
      const deposited = Boolean(existingRaffle.prize_deposited_at)
      const released =
        Boolean(existingRaffle.prize_returned_at) ||
        Boolean(existingRaffle.nft_transfer_transaction)
      if (!escrowCheck.holds && deposited && !released && escrowCheck.error) {
        return NextResponse.json(
          {
            error: `Escrow wallet check failed. Verify escrow state before deleting: ${escrowCheck.error}`,
          },
          { status: 400 }
        )
      }
      escrowCurrentlyHoldsPrize = escrowCheck.holds
    } else if (isPartnerSplPrizeRaffle(existingRaffle)) {
      const escrowCheck = await checkEscrowHoldsPartnerSplPrize(existingRaffle)
      const deposited = Boolean(existingRaffle.prize_deposited_at)
      const released =
        Boolean(existingRaffle.prize_returned_at) ||
        Boolean(existingRaffle.nft_transfer_transaction)
      if (!escrowCheck.holds && deposited && !released && escrowCheck.error) {
        return NextResponse.json(
          {
            error: `Escrow wallet check failed. Verify escrow state before deleting: ${escrowCheck.error}`,
          },
          { status: 400 }
        )
      }
      escrowCurrentlyHoldsPrize = escrowCheck.holds
    }

    // Safety net: only auto-return when escrow holds the prize **and** this listing has a verified
    // deposit. Otherwise duplicate listings (same mint as another row that actually deposited) look
    // like escrow holds the NFT on-chain while `prize_deposited_at` is null — transfer would fail with
    // "Prize deposit is not verified". Full admin can then delete the orphan DB row without return.
    const depositVerifiedForThisListing = Boolean(existingRaffle.prize_deposited_at)
    const requiresPrizeReturnBeforeDelete =
      (existingRaffle.prize_type === 'nft' || isPartnerSplPrizeRaffle(existingRaffle)) &&
      escrowCurrentlyHoldsPrize &&
      depositVerifiedForThisListing &&
      !existingRaffle.prize_returned_at &&
      !existingRaffle.nft_transfer_transaction
    if (requiresPrizeReturnBeforeDelete) {
      const returnResult = isPartnerSplPrizeRaffle(existingRaffle)
        ? await transferPartnerSplPrizeToCreator(raffleId, 'cancelled')
        : await transferNftPrizeToCreator(raffleId, 'cancelled')
      if (!returnResult.ok) {
        return NextResponse.json(
          {
            error: `Cannot delete raffle until the prize is returned to creator: ${returnResult.error ?? 'return failed'}`,
          },
          { status: 400 }
        )
      }
    }

    // Hard delete (entries cascade delete).
    try {
      await recordRaffleAdminDeletion({
        raffle: existingRaffle,
        adminWallet: session.wallet,
        deleteReason: deleteReasonParsed!,
      })
    } catch (auditErr) {
      const detail = auditErr instanceof Error ? auditErr.message : String(auditErr)
      console.error('[DELETE raffle] audit insert failed:', auditErr)
      return NextResponse.json(
        {
          error: `Could not save the deletion audit log (${detail}). Apply Supabase migration 071 (table raffle_admin_deletions), confirm RLS is enabled, then retry. The raffle was not deleted.`,
        },
        { status: 503 }
      )
    }

    const success = await deleteRaffle(raffleId)

    if (!success) {
      return NextResponse.json(
        {
          error:
            'Database could not delete this raffle (row missing or FK conflict). Check Supabase logs.',
        },
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
