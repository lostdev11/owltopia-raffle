import { NextResponse } from 'next/server'
import {
  PACK_CATEGORY_WEIGHTS_BPS,
  PACK_NFT_VALUE_BANDS,
  PACK_OWL_TIERS,
  PACK_OWL_USD_FEE,
  PACK_PRICE_OWL,
  PACK_PRICE_SOL,
  PACK_RTP_BPS,
  PACK_SOL_TIERS,
  PACKS_PRODUCT_SLUG,
} from '@/lib/packs/config'
import {
  countAvailableNfts,
  defaultProductFallback,
  getActivePackProduct,
  getPackProductForCheckout,
  getPackVaultConfig,
  listPackInventory,
  listRecentCompletedOpens,
} from '@/lib/packs/db'
import { isPackOwlCheckoutEnabled } from '@/lib/db/pack-public-settings'
import { quotePackOwlCheckoutFee } from '@/lib/packs/owl-checkout-fee'
import { simulatePackEvFromInventory } from '@/lib/packs/ev-simulator'
import { computePackOddsPercentages } from '@/lib/packs/odds'
import {
  PACK_JACKPOT_CONTRIBUTION_SOL,
  PACK_JACKPOT_WIN_ODDS_BPS,
  formatJackpotPoolSol,
  jackpotWinPercentLabel,
} from '@/lib/packs/jackpot'
import { PACKS_PRODUCT_SLUG_MAIN, PACKS_PRODUCT_SLUG_OWL } from '@/lib/packs/product-pools'
import { getPacksVaultPublicKey } from '@/lib/packs/vault'
import { isPackVrfEnabled, resolvePackOpenAlgo } from '@/lib/packs/vrf-config'

export const dynamic = 'force-dynamic'

function mapInventoryRows(
  inventory: Awaited<ReturnType<typeof listPackInventory>>
) {
  return inventory.map((r) => ({
    id: r.id,
    mint_address: r.mint_address,
    fair_value_sol: Number(r.fair_value_sol),
    name: r.name,
    image_url: r.image_url,
    odds_tier: (r.odds_tier === 'premium_1pct' ? 'premium_1pct' : 'standard') as
      | 'standard'
      | 'premium_1pct',
  }))
}

export async function GET() {
  try {
    let product = null as Awaited<ReturnType<typeof getActivePackProduct>>
    let owlProduct = null as Awaited<ReturnType<typeof getPackProductForCheckout>>
    let vaultConfig = null as Awaited<ReturnType<typeof getPackVaultConfig>> | null
    let nftCountMain = 0
    let nftCountOwl = 0
    let recent: Awaited<ReturnType<typeof listRecentCompletedOpens>> = []
    let inventoryMain: Awaited<ReturnType<typeof listPackInventory>> = []
    let inventoryOwl: Awaited<ReturnType<typeof listPackInventory>> = []

    try {
      product = await getActivePackProduct()
      owlProduct = await getPackProductForCheckout('OWL')
      vaultConfig = await getPackVaultConfig()
      if (product) {
        nftCountMain = await countAvailableNfts(product.id)
        inventoryMain = await listPackInventory('available', product.id)
      }
      if (owlProduct) {
        nftCountOwl = await countAvailableNfts(owlProduct.id)
        inventoryOwl = await listPackInventory('available', owlProduct.id)
      }
      recent = await listRecentCompletedOpens(24)
    } catch {
      vaultConfig = null
    }

    const fallback = defaultProductFallback()
    const priceSol = product ? Number(product.price_sol) : PACK_PRICE_SOL
    const rtpBps = product ? product.rtp_bps : PACK_RTP_BPS
    const paused = vaultConfig?.paused ?? true
    const pauseReason = vaultConfig?.pause_reason ?? 'Packs not configured yet'
    const vault = getPacksVaultPublicKey() || vaultConfig?.vault_pubkey || null

    let owlCheckoutEnabled = false
    let owlFeeSol: number | null = null
    let owlFeeLamports: string | null = null
    let solUsdPrice: number | null = null
    try {
      owlCheckoutEnabled = await isPackOwlCheckoutEnabled()
      const feeQuote = await quotePackOwlCheckoutFee()
      if (feeQuote) {
        owlFeeSol = feeQuote.feeSol
        owlFeeLamports = feeQuote.feeLamports.toString()
        solUsdPrice = feeQuote.solUsdPrice
      }
    } catch {
      // Non-fatal — UI still shows fixed 20 $OWL + $1 fee label
    }

    const nftMain = mapInventoryRows(inventoryMain)
    const nftOwl = mapInventoryRows(inventoryOwl)

    const ev = simulatePackEvFromInventory({
      owlSolPrice: vaultConfig?.owl_sol_price ?? null,
      inventory: inventoryMain,
      productShelfSlug: PACKS_PRODUCT_SLUG_MAIN,
    })

    const evOwl = simulatePackEvFromInventory({
      owlSolPrice: vaultConfig?.owl_sol_price ?? null,
      inventory: inventoryOwl,
      paymentCurrency: 'OWL',
      paymentFeeSol: owlFeeSol,
      productShelfSlug: PACKS_PRODUCT_SLUG_OWL,
    })

    const oddsPct = computePackOddsPercentages({
      owlSolPrice: vaultConfig?.owl_sol_price ?? null,
      nftInventory: nftMain,
      productSlug: PACKS_PRODUCT_SLUG_MAIN,
    })

    const oddsPctOwl = computePackOddsPercentages({
      owlSolPrice: vaultConfig?.owl_sol_price ?? null,
      nftInventory: nftOwl,
      productSlug: PACKS_PRODUCT_SLUG_OWL,
    })

    const mainJackpotPool = Number(product?.jackpot_pool_sol ?? vaultConfig?.jackpot_pool_sol ?? 0)
    const owlJackpotPool = Number(owlProduct?.jackpot_pool_sol ?? 0)

    return NextResponse.json({
      product: {
        slug: product?.slug ?? PACKS_PRODUCT_SLUG,
        name: product?.name ?? fallback.name,
        priceSol,
        priceOwl: PACK_PRICE_OWL,
        owlUsdFee: PACK_OWL_USD_FEE,
        rtpBps,
        categoryWeightsBps: {
          owl: product?.category_owl_bps ?? PACK_CATEGORY_WEIGHTS_BPS.owl,
          sol: product?.category_sol_bps ?? PACK_CATEGORY_WEIGHTS_BPS.sol,
          nft: product?.category_nft_bps ?? PACK_CATEGORY_WEIGHTS_BPS.nft,
        },
      },
      productShelves: {
        main: {
          slug: product?.slug ?? PACKS_PRODUCT_SLUG_MAIN,
          name: product?.name ?? 'Owl Pack (0.1 SOL)',
          availableNfts: nftCountMain,
          shelfPaused: product?.shelf_paused === true,
          shelfPauseReason: product?.shelf_pause_reason ?? null,
        },
        owl: owlProduct
          ? {
              slug: owlProduct.slug,
              name: owlProduct.name,
              availableNfts: nftCountOwl,
              shelfPaused: owlProduct.shelf_paused === true,
              shelfPauseReason: owlProduct.shelf_pause_reason ?? null,
            }
          : null,
      },
      owlCheckout: {
        enabled: owlCheckoutEnabled,
        priceOwl: PACK_PRICE_OWL,
        usdFee: PACK_OWL_USD_FEE,
        feeSol: owlFeeSol,
        feeLamports: owlFeeLamports,
        solUsdPrice,
      },
      odds: {
        owlTiers: oddsPct.owlTiers,
        solTiers: oddsPct.solTiers,
        premiumNft: oddsPct.premiumNft,
        nftInventory: oddsPct.nftInventory.slice(0, 40),
        nftBands: PACK_NFT_VALUE_BANDS.map((b) => ({
          min: b.minFairValueSol,
          max: b.maxFairValueSol,
          weight: b.weight,
        })),
        categories: oddsPct.categories,
        owlTiersRaw: PACK_OWL_TIERS.map((t) => ({ amount: t.amount, weight: t.weight })),
        solTiersRaw: PACK_SOL_TIERS.map((t) => ({ amountSol: t.amountSol, weight: t.weight })),
      },
      oddsByPayment: {
        SOL: {
          categories: oddsPct.categories,
          owlTiers: oddsPct.owlTiers,
          solTiers: oddsPct.solTiers,
          premiumNft: oddsPct.premiumNft,
          nftInventory: oddsPct.nftInventory.slice(0, 40),
          shelfLabel: '0.1 SOL pack shelf',
        },
        OWL: {
          categories: oddsPctOwl.categories,
          owlTiers: oddsPctOwl.owlTiers,
          solTiers: oddsPctOwl.solTiers,
          premiumNft: oddsPctOwl.premiumNft,
          nftInventory: oddsPctOwl.nftInventory.slice(0, 40),
          shelfLabel: '$OWL pack shelf (70% OWL / 30% NFT, no SOL cash)',
        },
      },
      fairness: {
        openAlgo: resolvePackOpenAlgo(),
        vrfEnabled: isPackVrfEnabled(),
      },
      jackpot: {
        poolSol: mainJackpotPool,
        contributionSol: Number(
          product?.jackpot_contribution_sol ??
            vaultConfig?.jackpot_contribution_sol ??
            PACK_JACKPOT_CONTRIBUTION_SOL
        ),
        winOddsBps: Number(
          product?.jackpot_win_odds_bps ?? vaultConfig?.jackpot_win_odds_bps ?? PACK_JACKPOT_WIN_ODDS_BPS
        ),
        winPercentLabel: jackpotWinPercentLabel(
          Number(
            product?.jackpot_win_odds_bps ??
              vaultConfig?.jackpot_win_odds_bps ??
              PACK_JACKPOT_WIN_ODDS_BPS
          )
        ),
        poolLabel: formatJackpotPoolSol(mainJackpotPool),
      },
      jackpotByPayment: {
        SOL: {
          poolSol: mainJackpotPool,
          poolLabel: formatJackpotPoolSol(mainJackpotPool),
        },
        OWL: {
          poolSol: owlJackpotPool,
          poolLabel: formatJackpotPoolSol(owlJackpotPool),
        },
      },
      vault: {
        address: vault,
        paused,
        pauseReason: paused ? pauseReason : null,
        availableNfts: nftCountMain,
        availableNftsOwlShelf: nftCountOwl,
        owlSolPrice:
          vaultConfig?.owl_sol_price != null ? Number(vaultConfig.owl_sol_price) : null,
      },
      ev: {
        targetEvSol: ev.targetEvSol,
        estimatedEvSol: ev.estimatedEvSol,
        estimatedRtpBps: ev.estimatedRtpBps,
      },
      evByPayment: {
        SOL: {
          packPriceSol: ev.packPriceSol,
          targetEvSol: ev.targetEvSol,
          estimatedEvSol: ev.estimatedEvSol,
          estimatedRtpBps: ev.estimatedRtpBps,
        },
        OWL: {
          packPriceSol: evOwl.packPriceSol,
          targetEvSol: evOwl.targetEvSol,
          estimatedEvSol: evOwl.estimatedEvSol,
          estimatedRtpBps: evOwl.estimatedRtpBps,
        },
      },
      recentOpens: recent.map((o) => ({
        id: o.id,
        wallet: o.buyer_wallet,
        category: o.category,
        prizeLabel: o.prize_label,
        isJackpotWin: o.is_jackpot_win === true,
        completedAt: o.completed_at,
      })),
    })
  } catch (e) {
    console.error('[packs] GET config', e)
    return NextResponse.json({ error: 'Failed to load packs config' }, { status: 500 })
  }
}
