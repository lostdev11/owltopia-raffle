import { NextRequest, NextResponse } from 'next/server'
import { getPackOpenById, getPackVaultConfig } from '@/lib/packs/db'
import { pickCategory, pickJackpotWin, pickNftFromSnapshot, hashPackOpenCommit, recomputeOpenFromSeed, verifyCommitHash } from '@/lib/packs/rng'
import { PACK_JACKPOT_MIN_PAYOUT_SOL } from '@/lib/packs/jackpot'
import { PACK_OPEN_ALGO_V2_VRF } from '@/lib/packs/config'
import type { PackNftPoolSnapshotRow } from '@/lib/packs/types'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: Ctx) {
  try {
    const { id } = await context.params
    const open = await getPackOpenById(id)
    if (!open) {
      return NextResponse.json({ error: 'Open not found' }, { status: 404 })
    }

    const config = await getPackVaultConfig().catch(() => null)
    let recomputed = null as ReturnType<typeof recomputeOpenFromSeed> | null
    let commitOk: boolean | null = null
    let recomputedNftMint: string | null = null
    let nftSnapshotMatches: boolean | null = null

    let recomputedJackpotWin: boolean | null = null

    if (open.open_seed && open.status === 'completed') {
      recomputed = recomputeOpenFromSeed(open.open_seed, config?.owl_sol_price ?? null)
      commitOk = open.open_commit_hash
        ? verifyCommitHash(open.open_seed, open.open_commit_hash)
        : null

      const oddsBps = Number(config?.jackpot_win_odds_bps ?? 20)
      const contribution = Number(open.jackpot_contribution_sol ?? 0.02)
      const poolBefore = open.is_jackpot_win
        ? Math.max(0, Number(open.jackpot_amount_sol ?? 0) - contribution)
        : null
      const poolAfterContrib =
        poolBefore != null
          ? poolBefore + contribution
          : Number(config?.jackpot_pool_sol ?? 0)
      recomputedJackpotWin =
        pickJackpotWin(open.open_seed, oddsBps) &&
        (open.is_jackpot_win
          ? Number(open.jackpot_amount_sol ?? 0) >= PACK_JACKPOT_MIN_PAYOUT_SOL
          : poolAfterContrib >= PACK_JACKPOT_MIN_PAYOUT_SOL)

      if (open.is_jackpot_win) {
        // Jackpot replaces category roll — skip NFT recompute
      } else {
      const category = pickCategory(open.open_seed)
      if (category === 'nft' && open.nft_pool_snapshot && Array.isArray(open.nft_pool_snapshot)) {
        try {
          const pick = pickNftFromSnapshot(
            open.open_seed,
            open.nft_pool_snapshot as PackNftPoolSnapshotRow[]
          )
          recomputedNftMint = pick.mint_address
          nftSnapshotMatches =
            Boolean(open.nft_mint_address) &&
            pick.mint_address.trim().toLowerCase() ===
              (open.nft_mint_address ?? '').trim().toLowerCase()
        } catch {
          nftSnapshotMatches = false
        }
      }
      }
    }

    const isVrf = open.open_algo === PACK_OPEN_ALGO_V2_VRF || Boolean(open.open_vrf_fulfill_tx)

    return NextResponse.json({
      id: open.id,
      status: open.status,
      buyerWallet: open.buyer_wallet,
      paymentSignature: open.payment_signature,
      payoutSignature: open.payout_signature,
      openAlgo: open.open_algo,
      openSeed: open.status === 'completed' ? open.open_seed : null,
      openCommitHash: open.open_commit_hash,
      category: open.category,
      prizeLabel: open.prize_label,
      owlAmount: open.owl_amount,
      solAmount: open.sol_amount,
      nftMint: open.nft_mint_address,
      fairValueSol: open.fair_value_sol,
      freeTicketCredits: open.free_ticket_credits,
      isJackpotWin: open.is_jackpot_win === true,
      jackpotAmountSol: open.jackpot_amount_sol,
      jackpotContributionSol: open.jackpot_contribution_sol,
      completedAt: open.completed_at,
      vrf: isVrf
        ? {
            provider: open.open_vrf_provider ?? 'switchboard',
            status: open.open_vrf_status ?? null,
            account: open.open_vrf_account ?? null,
            requestTx: open.open_vrf_request_tx ?? null,
            fulfillTx: open.open_vrf_fulfill_tx ?? null,
            error: open.open_vrf_error ?? null,
          }
        : null,
      verify:
        open.status === 'completed' && open.open_seed
          ? {
              commitMatches: commitOk,
              recomputedCategory: recomputed?.category ?? null,
              recomputedPick: recomputed?.pick ?? null,
              recomputedNftMint,
              nftSnapshotMatches,
              recomputedJackpotWin,
              expectedCommitHash: hashPackOpenCommit(open.open_seed),
              randomnessSource: isVrf
                ? 'Switchboard on-chain VRF'
                : 'Local commit–reveal (server seed)',
            }
          : null,
    })
  } catch (e) {
    console.error('[packs] verify GET', e)
    return NextResponse.json({ error: 'Failed to load open' }, { status: 500 })
  }
}
