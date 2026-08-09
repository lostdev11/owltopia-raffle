import { NextRequest, NextResponse } from 'next/server'
import { getPackOpenById } from '@/lib/packs/db'
import { getPackVaultConfig } from '@/lib/packs/db'
import { hashPackOpenCommit, recomputeOpenFromSeed, verifyCommitHash } from '@/lib/packs/rng'

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

    if (open.open_seed && open.status === 'completed') {
      recomputed = recomputeOpenFromSeed(open.open_seed, config?.owl_sol_price ?? null)
      commitOk = open.open_commit_hash
        ? verifyCommitHash(open.open_seed, open.open_commit_hash)
        : null
    }

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
      completedAt: open.completed_at,
      verify:
        open.status === 'completed' && open.open_seed
          ? {
              commitMatches: commitOk,
              recomputedCategory: recomputed?.category ?? null,
              recomputedPick: recomputed?.pick ?? null,
              expectedCommitHash: hashPackOpenCommit(open.open_seed),
            }
          : null,
    })
  } catch (e) {
    console.error('[packs] verify GET', e)
    return NextResponse.json({ error: 'Failed to load open' }, { status: 500 })
  }
}
