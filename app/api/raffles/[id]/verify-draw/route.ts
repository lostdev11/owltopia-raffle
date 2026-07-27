import { NextRequest, NextResponse } from 'next/server'
import { getEntriesByRaffleId } from '@/lib/db/raffles'
import { getRaffleByIdOrSlug } from '@/lib/raffles/resolve-raffle-route-param'
import {
  buildDrawLedger,
  encodeDrawRevealMemo,
  verifyDraw,
  DRAW_ALGO_V1,
} from '@/lib/raffles/draw'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'

function solscanTxUrl(signature: string): string {
  const cluster = /devnet/i.test(resolveServerSolanaRpcUrl()) ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${signature}${cluster}`
}

/**
 * GET /api/raffles/[id]/verify-draw
 * Public: recompute draw from confirmed entries + stored seed/index; return audit pack + Solscan link.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleByIdOrSlug(id.trim())
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const winnerWallet = (raffle.winner_wallet ?? '').trim()
    if (!winnerWallet) {
      return NextResponse.json(
        {
          status: 'not_drawn',
          message: 'This raffle has not selected a winner yet.',
        },
        { status: 200 }
      )
    }

    const algo = (raffle.draw_algo ?? '').trim()
    const drawSeed = (raffle.draw_seed ?? '').trim()
    const soldCount = raffle.draw_sold_count ?? null
    const winnerIndex = raffle.draw_winner_index ?? null
    const ledgerHash = (raffle.draw_ledger_hash ?? '').trim().toLowerCase()
    const revealTx = (raffle.draw_reveal_tx ?? '').trim()

    if (!algo || !drawSeed || soldCount == null || winnerIndex == null || !ledgerHash) {
      return NextResponse.json(
        {
          status: 'legacy_draw',
          message:
            'This raffle was drawn before public verify seeds were stored. Payments and prize transfers remain on-chain; future draws include a verify pack.',
          winnerWallet,
          winnerSelectedAt: raffle.winner_selected_at,
        },
        { status: 200 }
      )
    }

    const entries = await getEntriesByRaffleId(raffle.id)
    const ledger = buildDrawLedger(entries)
    const verification = verifyDraw({
      algo,
      raffleId: raffle.id,
      drawSeed,
      soldCount,
      winnerIndex,
      winnerWallet,
      ledgerHash,
      entries,
    })

    let memo: string
    try {
      memo = verification.ok
        ? verification.memo
        : encodeDrawRevealMemo({
            algo: algo || DRAW_ALGO_V1,
            raffleId: raffle.id,
            drawSeed,
            soldCount,
            winnerIndex,
            ledgerHash,
          })
    } catch {
      memo = `${algo}:${raffle.id}:${drawSeed}:${soldCount}:${winnerIndex}:${ledgerHash}`
    }

    return NextResponse.json({
      status: verification.ok ? 'verified' : 'mismatch',
      ok: verification.ok,
      error: verification.ok ? null : verification.error,
      algo,
      drawSeed,
      soldCount,
      winnerIndex,
      winnerWallet,
      ledgerHash,
      recomputedLedgerHash: ledger.ledgerHash,
      recomputedSoldCount: ledger.soldCount,
      ranges: ledger.ranges,
      memo,
      revealTx: revealTx || null,
      revealTxUrl: revealTx ? solscanTxUrl(revealTx) : null,
      revealedAt: raffle.draw_revealed_at ?? null,
      howItWorks:
        'Each confirmed ticket is one equal chance. Wallets are sorted lexicographically into a ticket ledger. winnerIndex = SHA256(seed:soldCount) % soldCount (owltopia-draw-v1). The reveal memo on Solana publishes seed, soldCount, winnerIndex, and ledgerHash.',
    })
  } catch (error) {
    console.error('[verify-draw]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to verify draw' },
      { status: 500 }
    )
  }
}
