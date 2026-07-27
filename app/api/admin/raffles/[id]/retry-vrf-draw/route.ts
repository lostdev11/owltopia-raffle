import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { getRaffleById, selectWinner } from '@/lib/db/raffles'
import { raffleUsesDrawVrf, DRAW_ALGO_V3_VRF } from '@/lib/raffles/draw'

export const dynamic = 'force-dynamic'
/** VRF commit+reveal can take a while on-chain. */
export const maxDuration = 120

/**
 * POST /api/admin/raffles/[id]/retry-vrf-draw
 * Admin: retry Switchboard VRF for a raffle stuck in pending/failed (no silent v2 fallback).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    await requireAdminSession(request)
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

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

    const algo = (raffle.draw_algo ?? '').trim()
    if (algo !== DRAW_ALGO_V3_VRF && !raffleUsesDrawVrf(raffle)) {
      return NextResponse.json(
        { error: 'Raffle is not configured for VRF draw (owltopia-draw-v3-vrf)' },
        { status: 400 }
      )
    }

    const winnerWallet = await selectWinner(raffle.id, false, { forceVrfRetry: true })
    if (!winnerWallet) {
      const latest = await getRaffleById(raffle.id)
      return NextResponse.json(
        {
          ok: false,
          error: latest?.draw_vrf_error || 'VRF retry did not complete — check draw_vrf_status',
          drawVrfStatus: latest?.draw_vrf_status ?? null,
          drawVrfRequestTx: latest?.draw_vrf_request_tx ?? null,
          drawVrfAccount: latest?.draw_vrf_account ?? null,
        },
        { status: 409 }
      )
    }

    const latest = await getRaffleById(raffle.id)
    return NextResponse.json({
      ok: true,
      winnerWallet,
      drawSeed: latest?.draw_seed ?? null,
      drawVrfStatus: latest?.draw_vrf_status ?? null,
      drawVrfRequestTx: latest?.draw_vrf_request_tx ?? null,
      drawVrfFulfillTx: latest?.draw_vrf_fulfill_tx ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Retry VRF failed'
    if (/unauthorized|forbidden|admin/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 401 })
    }
    console.error('[retry-vrf-draw]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
