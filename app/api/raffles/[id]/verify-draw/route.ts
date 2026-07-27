import { NextRequest, NextResponse } from 'next/server'
import { getEntriesByRaffleId } from '@/lib/db/raffles'
import { getRaffleByIdOrSlug } from '@/lib/raffles/resolve-raffle-route-param'
import {
  buildDrawLedger,
  encodeDrawRevealMemo,
  verifyDraw,
  DRAW_ALGO_V1,
  DRAW_ALGO_V2_COMMIT_REVEAL,
  DRAW_ALGO_V3_VRF,
  hashDrawCommit,
} from '@/lib/raffles/draw'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'

export const dynamic = 'force-dynamic'

function solscanTxUrl(signature: string): string {
  const cluster = /devnet/i.test(resolveServerSolanaRpcUrl()) ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${signature}${cluster}`
}

/**
 * GET /api/raffles/[id]/verify-draw
 * Public: commit hash (pre-draw) or full verify pack after draw + Solscan link.
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
    const commitHash = (raffle.draw_commit_hash ?? '').trim().toLowerCase()
    const committedAt = raffle.draw_committed_at ?? null
    const algoHint = (raffle.draw_algo ?? '').trim() || (commitHash ? DRAW_ALGO_V2_COMMIT_REVEAL : null)
    const vrfStatus = (raffle.draw_vrf_status ?? '').trim()
    const vrfRequestTx = (raffle.draw_vrf_request_tx ?? '').trim()
    const vrfFulfillTx = (raffle.draw_vrf_fulfill_tx ?? '').trim()
    const vrfAccount = (raffle.draw_vrf_account ?? '').trim()

    if (!winnerWallet) {
      if (vrfStatus === 'pending' || vrfStatus === 'failed') {
        return NextResponse.json(
          {
            status: vrfStatus === 'failed' ? 'vrf_failed' : 'vrf_pending',
            message:
              vrfStatus === 'failed'
                ? raffle.draw_vrf_error ||
                  'VRF request failed. An admin can retry against the same frozen ticket ledger.'
                : 'Waiting for Switchboard VRF reveal. The ticket ledger is frozen; randomness is requested on-chain.',
            algo: algoHint || 'owltopia-draw-v3-vrf',
            drawVrfProvider: raffle.draw_vrf_provider ?? 'switchboard',
            drawVrfStatus: vrfStatus,
            drawVrfAccount: vrfAccount || null,
            drawVrfRequestTx: vrfRequestTx || null,
            drawVrfRequestTxUrl: vrfRequestTx ? solscanTxUrl(vrfRequestTx) : null,
            drawVrfError: raffle.draw_vrf_error ?? null,
            soldCount: raffle.draw_sold_count ?? null,
            ledgerHash: (raffle.draw_ledger_hash ?? '').trim().toLowerCase() || null,
            howItWorks:
              'owltopia-draw-v3-vrf: at draw time we freeze the ticket ledger, commit Switchboard randomness on-chain, then reveal. winnerIndex = SHA256(seed:soldCount) % soldCount using the VRF output as seed. No VRF runs on a second selling round or refund path.',
          },
          { status: 200 }
        )
      }
      if (commitHash) {
        return NextResponse.json(
          {
            status: 'committed',
            message:
              'A draw seed was committed when this raffle was created. The raw seed stays private until the draw; anyone can check that the revealed seed matches this commit hash afterward.',
            algo: algoHint,
            drawCommitHash: commitHash,
            drawCommittedAt: committedAt,
            howItWorks:
              'owltopia-draw-v2-commit-reveal: at create we publish SHA256(seed). At draw we reveal seed and compute winnerIndex = SHA256(seed:soldCount) % soldCount over the lexicographic ticket ledger.',
          },
          { status: 200 }
        )
      }
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
          drawCommitHash: commitHash || null,
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
      drawCommitHash: commitHash || null,
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

    let recomputedCommitHash: string | null = null
    try {
      recomputedCommitHash = hashDrawCommit(drawSeed)
    } catch {
      recomputedCommitHash = null
    }

    const isV2 = algo === DRAW_ALGO_V2_COMMIT_REVEAL || Boolean(commitHash)
    const isV3 = algo === DRAW_ALGO_V3_VRF || Boolean(vrfFulfillTx || vrfRequestTx)

    return NextResponse.json({
      status: verification.ok ? 'verified' : 'mismatch',
      ok: verification.ok,
      error: verification.ok ? null : verification.error,
      algo,
      drawSeed,
      drawCommitHash: commitHash || null,
      drawCommittedAt: committedAt,
      recomputedCommitHash,
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
      drawVrfProvider: raffle.draw_vrf_provider ?? null,
      drawVrfStatus: raffle.draw_vrf_status ?? null,
      drawVrfAccount: vrfAccount || null,
      drawVrfRequestTx: vrfRequestTx || null,
      drawVrfRequestTxUrl: vrfRequestTx ? solscanTxUrl(vrfRequestTx) : null,
      drawVrfFulfillTx: vrfFulfillTx || null,
      drawVrfFulfillTxUrl: vrfFulfillTx ? solscanTxUrl(vrfFulfillTx) : null,
      howItWorks: isV3
        ? 'VRF (owltopia-draw-v3-vrf): Switchboard on-demand randomness provides the seed at draw time. winnerIndex = SHA256(seed:soldCount) % soldCount over the frozen lexicographic ticket ledger. Verify recomputes from the published VRF seed; Solscan links show request + fulfill txs.'
        : isV2
          ? 'Commit–reveal (owltopia-draw-v2): SHA256(seed) was published at create. winnerIndex = SHA256(seed:soldCount) % soldCount over a lexicographic ticket ledger. Verify checks the seed against the commit hash and recomputes the winner.'
          : 'Each confirmed ticket is one equal chance. Wallets are sorted lexicographically into a ticket ledger. winnerIndex = SHA256(seed:soldCount) % soldCount (owltopia-draw-v1). The reveal memo on Solana publishes seed, soldCount, winnerIndex, and ledgerHash.',
    })
  } catch (error) {
    console.error('[verify-draw]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to verify draw' },
      { status: 500 }
    )
  }
}
