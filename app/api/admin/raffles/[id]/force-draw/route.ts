import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getRaffleById,
  getEntriesByRaffleId,
  selectWinner,
  canSelectWinner,
  calculateTicketsSold,
  getRaffleMinimum,
} from '@/lib/db/raffles'
import { raffleUsesDrawVrf, DRAW_ALGO_V3_VRF } from '@/lib/raffles/draw'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'

export const dynamic = 'force-dynamic'
/** VRF commit+reveal (when applicable) can take a while on-chain. */
export const maxDuration = 120

const DRAWABLE_STATUSES = new Set(['live', 'ready_to_draw', 'pending_min_not_met'])

/**
 * POST /api/admin/raffles/[id]/force-draw
 * Full admin: force winner selection for a stuck raffle.
 *
 * - Ignores end_time (ready_to_draw / failed VRF with future end_time still works)
 * - forceOverride=true bypasses the min-ticket threshold (still needs ≥1 confirmed ticket)
 * - VRF raffles always get a fresh Switchboard attempt (forceVrfRetry)
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const forceOverride = body.forceOverride === true

    const raffle = await getRaffleById(id.trim())
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    if ((raffle.winner_wallet ?? '').trim()) {
      return NextResponse.json(
        { error: 'Winner already selected', winnerWallet: raffle.winner_wallet },
        { status: 400 }
      )
    }

    const status = (raffle.status ?? '').trim().toLowerCase()
    if (!DRAWABLE_STATUSES.has(status)) {
      return NextResponse.json(
        {
          error: `Cannot force draw while status is "${raffle.status ?? 'unknown'}". Expected live, ready_to_draw, or pending_min_not_met.`,
        },
        { status: 400 }
      )
    }

    const needsPrizeEscrow =
      (raffle.prize_type === 'nft' || isPartnerSplPrizeRaffle(raffle)) && !raffle.prize_deposited_at
    if (needsPrizeEscrow) {
      return NextResponse.json(
        { error: 'Prize must be verified in escrow before drawing.' },
        { status: 400 }
      )
    }

    const entries = await getEntriesByRaffleId(raffle.id)
    const ticketsSold = calculateTicketsSold(entries)
    if (ticketsSold <= 0) {
      return NextResponse.json(
        { error: 'No confirmed tickets — cannot draw a winner.' },
        { status: 400 }
      )
    }

    if (!forceOverride && !canSelectWinner(raffle, entries)) {
      const minTickets = getRaffleMinimum(raffle) ?? raffle.min_tickets
      return NextResponse.json(
        {
          error:
            'Ticket threshold not met. Enable “Bypass minimum tickets” to force a draw anyway, or extend sales.',
          minTickets,
          ticketsSold,
          needsForceOverride: true,
        },
        { status: 409 }
      )
    }

    const isVrf =
      (raffle.draw_algo ?? '').trim() === DRAW_ALGO_V3_VRF || raffleUsesDrawVrf(raffle)

    const winnerWallet = await selectWinner(raffle.id, forceOverride, {
      forceVrfRetry: isVrf,
    })

    if (!winnerWallet) {
      const latest = await getRaffleById(raffle.id)
      const vrfErr = (latest?.draw_vrf_error ?? '').trim()
      const vrfStatus = (latest?.draw_vrf_status ?? '').trim()
      return NextResponse.json(
        {
          ok: false,
          error:
            vrfErr ||
            (vrfStatus === 'failed' || vrfStatus === 'pending'
              ? `VRF draw ${vrfStatus} — try again or check escrow / Switchboard`
              : 'Draw did not complete — check server logs'),
          drawVrfStatus: latest?.draw_vrf_status ?? null,
          drawVrfError: latest?.draw_vrf_error ?? null,
          drawVrfRequestTx: latest?.draw_vrf_request_tx ?? null,
          drawVrfAccount: latest?.draw_vrf_account ?? null,
          ticketsSold,
        },
        { status: 409 }
      )
    }

    const latest = await getRaffleById(raffle.id)
    return NextResponse.json({
      ok: true,
      success: true,
      raffleId: raffle.id,
      winnerWallet,
      forceOverride,
      vrfRetried: isVrf,
      drawAlgo: latest?.draw_algo ?? null,
      drawSeed: latest?.draw_seed ?? null,
      drawVrfStatus: latest?.draw_vrf_status ?? null,
      drawVrfRequestTx: latest?.draw_vrf_request_tx ?? null,
      drawVrfFulfillTx: latest?.draw_vrf_fulfill_tx ?? null,
      message: `Winner selected: ${winnerWallet}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Force draw failed'
    if (/unauthorized|forbidden|admin/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 401 })
    }
    console.error('[force-draw]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
