import { NextResponse } from 'next/server'
import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_NFT_VALUE_BANDS,
  PACK_OWL_TIERS,
  PACK_OWL_TO_TICKET_RATIO,
  PACK_PRICE_SOL,
  PACK_RTP_BPS,
  PACK_SOL_TIERS,
  PACKS_PRODUCT_SLUG,
} from '@/lib/packs/config'
import {
  countAvailableNfts,
  defaultProductFallback,
  getActivePackProduct,
  getPackVaultConfig,
  listPackInventory,
  listRecentCompletedOpens,
} from '@/lib/packs/db'
import { simulatePackEvFromInventory } from '@/lib/packs/ev-simulator'
import { computePackOddsPercentages } from '@/lib/packs/odds'
import {
  PACK_JACKPOT_CONTRIBUTION_SOL,
  PACK_JACKPOT_WIN_ODDS_BPS,
  formatJackpotPoolSol,
  jackpotWinPercentLabel,
} from '@/lib/packs/jackpot'
import { getPacksVaultPublicKey } from '@/lib/packs/vault'
import { isPackVrfEnabled, resolvePackOpenAlgo } from '@/lib/packs/vrf-config'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    let product = null as Awaited<ReturnType<typeof getActivePackProduct>>
    let vaultConfig = null as Awaited<ReturnType<typeof getPackVaultConfig>> | null
    let nftCount = 0
    let recent: Awaited<ReturnType<typeof listRecentCompletedOpens>> = []
    let inventory: Awaited<ReturnType<typeof listPackInventory>> = []

    try {
      product = await getActivePackProduct()
      vaultConfig = await getPackVaultConfig()
      nftCount = await countAvailableNfts()
      recent = await listRecentCompletedOpens(24)
      inventory = await listPackInventory('available')
    } catch {
      vaultConfig = null
    }

    const fallback = defaultProductFallback()
    const priceSol = product ? Number(product.price_sol) : PACK_PRICE_SOL
    const rtpBps = product ? product.rtp_bps : PACK_RTP_BPS
    const paused = vaultConfig?.paused ?? true
    const pauseReason = vaultConfig?.pause_reason ?? 'Packs not configured yet'
    const vault = getPacksVaultPublicKey() || vaultConfig?.vault_pubkey || null

    const ev = simulatePackEvFromInventory({
      owlSolPrice: vaultConfig?.owl_sol_price ?? null,
      inventory,
    })

    const oddsPct = computePackOddsPercentages({
      owlSolPrice: vaultConfig?.owl_sol_price ?? null,
      nftInventory: inventory.map((r) => ({
        id: r.id,
        mint_address: r.mint_address,
        fair_value_sol: Number(r.fair_value_sol),
        name: r.name,
        image_url: r.image_url,
      })),
    })

    return NextResponse.json({
      product: {
        slug: product?.slug ?? PACKS_PRODUCT_SLUG,
        name: product?.name ?? fallback.name,
        priceSol,
        rtpBps,
        categoryWeightsBps: {
          owl: product?.category_owl_bps ?? PACK_CATEGORY_WEIGHTS_BPS.owl,
          sol: product?.category_sol_bps ?? PACK_CATEGORY_WEIGHTS_BPS.sol,
          nft: product?.category_nft_bps ?? PACK_CATEGORY_WEIGHTS_BPS.nft,
        },
      },
      odds: {
        owlTiers: oddsPct.owlTiers,
        solTiers: oddsPct.solTiers,
        nftInventory: oddsPct.nftInventory.slice(0, 40),
        nftBands: PACK_NFT_VALUE_BANDS.map((b) => ({
          min: b.minFairValueSol,
          max: b.maxFairValueSol,
          weight: b.weight,
        })),
        categories: oddsPct.categories,
        owlToTicketRatio: PACK_OWL_TO_TICKET_RATIO,
        /** Raw weight ladders (admin / legacy). Prefer percent fields above. */
        owlTiersRaw: PACK_OWL_TIERS.map((t) => ({ amount: t.amount, weight: t.weight })),
        solTiersRaw: PACK_SOL_TIERS.map((t) => ({ amountSol: t.amountSol, weight: t.weight })),
      },
      fairness: {
        openAlgo: resolvePackOpenAlgo(),
        vrfEnabled: isPackVrfEnabled(),
      },
      jackpot: {
        poolSol: Number(vaultConfig?.jackpot_pool_sol ?? 0),
        contributionSol: Number(
          vaultConfig?.jackpot_contribution_sol ?? PACK_JACKPOT_CONTRIBUTION_SOL
        ),
        winOddsBps: Number(vaultConfig?.jackpot_win_odds_bps ?? PACK_JACKPOT_WIN_ODDS_BPS),
        winPercentLabel: jackpotWinPercentLabel(
          Number(vaultConfig?.jackpot_win_odds_bps ?? PACK_JACKPOT_WIN_ODDS_BPS)
        ),
        poolLabel: formatJackpotPoolSol(Number(vaultConfig?.jackpot_pool_sol ?? 0)),
      },
      vault: {
        address: vault,
        paused,
        pauseReason: paused ? pauseReason : null,
        availableNfts: nftCount,
      },
      ev: {
        targetEvSol: ev.targetEvSol,
        estimatedEvSol: ev.estimatedEvSol,
        estimatedRtpBps: ev.estimatedRtpBps,
      },
      recentOpens: recent.map((o) => ({
        id: o.id,
        wallet: o.buyer_wallet,
        category: o.category,
        prizeLabel: o.prize_label,
        freeTicketCredits: o.free_ticket_credits,
        isJackpotWin: o.is_jackpot_win === true,
        completedAt: o.completed_at,
      })),
    })
  } catch (e) {
    console.error('[packs] GET config', e)
    return NextResponse.json({ error: 'Failed to load packs config' }, { status: 500 })
  }
}
