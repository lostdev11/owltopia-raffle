import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  addPackInventoryNft,
  countAvailableNfts,
  getActivePackProduct,
  getPackProductBySlug,
  getPackVaultConfig,
  listPackInventory,
  listPackProducts,
  removePackInventoryNft,
  updatePackInventoryOddsTier,
  updatePackProduct,
  updatePackVaultConfig,
  recalculatePackJackpotPool,
} from '@/lib/packs/db'
import { PACKS_PRODUCT_SLUG_MAIN, PACKS_PRODUCT_SLUG_OWL } from '@/lib/packs/product-pools'
import { simulatePackEvFromInventory } from '@/lib/packs/ev-simulator'
import { isPackInventoryPrizeStandard } from '@/lib/packs/types'
import { isPackNftFairValueSol, PACK_NFT_MAX_FAIR_SOL, PACK_NFT_MIN_FAIR_SOL,
  isPackNftOddsTier,
} from '@/lib/packs/config'
import {
  getPacksVaultPublicKey,
  getPacksVaultSolBalance,
  getPacksVaultOwlBalanceUi,
} from '@/lib/packs/vault'
import { isPackVrfEnabled, resolvePackOpenAlgo } from '@/lib/packs/vrf-config'
import {
  formatJackpotPoolSol,
  jackpotWinPercentLabel,
  PACK_JACKPOT_CONTRIBUTION_SOL,
  PACK_JACKPOT_WIN_ODDS_BPS,
} from '@/lib/packs/jackpot'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const config = await getPackVaultConfig()
    const products = await listPackProducts().catch(() => [])
    const mainProduct =
      products.find((p) => p.slug === PACKS_PRODUCT_SLUG_MAIN) ?? (await getActivePackProduct())
    const owlProduct =
      products.find((p) => p.slug === PACKS_PRODUCT_SLUG_OWL) ??
      (await getPackProductBySlug(PACKS_PRODUCT_SLUG_OWL))
    const inventory = await listPackInventory()
    const nftCountMain = mainProduct ? await countAvailableNfts(mainProduct.id) : 0
    const nftCountOwl = owlProduct ? await countAvailableNfts(owlProduct.id) : 0
    const solBal = await getPacksVaultSolBalance()
    const owlBal = await getPacksVaultOwlBalanceUi()
    const ev = simulatePackEvFromInventory({
      owlSolPrice: config.owl_sol_price,
      inventory: mainProduct
        ? inventory.filter((r) => r.product_id === mainProduct.id)
        : inventory,
      productShelfSlug: PACKS_PRODUCT_SLUG_MAIN,
    })

    return NextResponse.json({
      products: await Promise.all(
        products.map(async (p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          availableNfts: await countAvailableNfts(p.id),
          shelfPaused: p.shelf_paused === true,
          shelfPauseReason: p.shelf_pause_reason ?? null,
          jackpotPoolSol: Number(p.jackpot_pool_sol ?? 0),
          minNftCount: Number(p.min_nft_count ?? 1),
        }))
      ),
      vault: {
        configuredAddress: getPacksVaultPublicKey(),
        dbPubkey: config.vault_pubkey,
        paused: config.paused,
        pauseReason: config.pause_reason,
        minOwlBalance: config.min_owl_balance,
        minSolBalance: config.min_sol_balance,
        minNftCount: config.min_nft_count,
        owlSolPrice: config.owl_sol_price,
        solBalance: solBal,
        owlBalance: owlBal,
        availableNfts: nftCountMain,
        availableNftsOwlShelf: nftCountOwl,
        jackpotPoolSol: Number(config.jackpot_pool_sol ?? 0),
        jackpotContributionSol: Number(
          config.jackpot_contribution_sol ?? PACK_JACKPOT_CONTRIBUTION_SOL
        ),
        jackpotWinOddsBps: Number(config.jackpot_win_odds_bps ?? PACK_JACKPOT_WIN_ODDS_BPS),
        jackpotPoolLabel: formatJackpotPoolSol(Number(config.jackpot_pool_sol ?? 0)),
        jackpotWinPercentLabel: jackpotWinPercentLabel(
          Number(config.jackpot_win_odds_bps ?? PACK_JACKPOT_WIN_ODDS_BPS)
        ),
      },
      fairness: {
        openAlgo: resolvePackOpenAlgo(),
        vrfEnabled: isPackVrfEnabled(),
      },
      ev,
      inventory,
    })
  } catch (e) {
    console.error('[admin packs] GET', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to load packs admin' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => ({}))

    if (typeof body.inventory_id === 'string' && body.odds_tier != null) {
      if (!isPackNftOddsTier(body.odds_tier)) {
        return NextResponse.json(
          { error: 'odds_tier must be standard or premium_1pct' },
          { status: 400 }
        )
      }
      const item = await updatePackInventoryOddsTier(body.inventory_id.trim(), body.odds_tier)
      return NextResponse.json({ ok: true, item })
    }

    if (typeof body.product_id === 'string' && body.clear_shelf_pause === true) {
      const updated = await updatePackProduct(body.product_id.trim(), {
        shelf_paused: false,
        shelf_pause_reason: null,
      })
      return NextResponse.json({ ok: true, product: updated })
    }

    if (body.recalculate_jackpot === true) {
      const productId =
        typeof body.product_id === 'string'
          ? body.product_id.trim()
          : (await getActivePackProduct())?.id
      if (!productId) {
        return NextResponse.json({ error: 'product_id required' }, { status: 400 })
      }
      const result = await recalculatePackJackpotPool({ productId })
      return NextResponse.json({
        ok: true,
        jackpot: {
          previousPoolSol: result.previousPoolSol,
          poolSol: result.expectedPoolSol,
          poolLabel: formatJackpotPoolSol(result.expectedPoolSol),
          completedContribSol: result.completedContribSol,
          paidUnfinishedContribSol: result.paidUnfinishedContribSol,
          completedOpens: result.completedOpens,
          paidUnfinishedOpens: result.paidUnfinishedOpens,
          sinceJackpotWinAt: result.sinceJackpotWinAt,
        },
      })
    }

    const patch: Parameters<typeof updatePackVaultConfig>[0] = {}

    if (typeof body.paused === 'boolean') patch.paused = body.paused
    if (typeof body.pause_reason === 'string' || body.pause_reason === null) {
      patch.pause_reason = body.pause_reason
    }
    if (typeof body.owl_sol_price === 'number' || body.owl_sol_price === null) {
      patch.owl_sol_price = body.owl_sol_price
    }
    if (typeof body.min_nft_count === 'number') patch.min_nft_count = body.min_nft_count
    if (typeof body.min_sol_balance === 'number') patch.min_sol_balance = body.min_sol_balance
    if (typeof body.min_owl_balance === 'number') patch.min_owl_balance = body.min_owl_balance

    const vault = getPacksVaultPublicKey()
    if (vault) patch.vault_pubkey = vault

    if (body.paused === false) {
      const main = await getActivePackProduct()
      const nftCount = main ? await countAvailableNfts(main.id) : 0
      const minNft = typeof body.min_nft_count === 'number' ? body.min_nft_count : undefined
      const config = await getPackVaultConfig()
      const need = minNft ?? config.min_nft_count
      if (nftCount < need) {
        return NextResponse.json(
          { error: `Cannot unpause: need ${need} NFT(s), have ${nftCount}` },
          { status: 400 }
        )
      }
      if (!getPacksVaultPublicKey()) {
        return NextResponse.json(
          { error: 'Cannot unpause: PACKS_VAULT_SECRET_KEY / wallet not configured' },
          { status: 400 }
        )
      }
      patch.pause_reason = null
    } else if (body.paused === true && patch.pause_reason === undefined) {
      patch.pause_reason = 'Paused by admin'
    }

    const updated = await updatePackVaultConfig(patch)
    return NextResponse.json({ ok: true, vault: updated })
  } catch (e) {
    console.error('[admin packs] PATCH', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Update failed' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => ({}))
    const mint = typeof body.mint_address === 'string' ? body.mint_address.trim() : ''
    const fair = Number(body.fair_value_sol)
    if (!mint || !isPackNftFairValueSol(fair)) {
      return NextResponse.json(
        {
          error: `mint_address and fair_value_sol (${PACK_NFT_MIN_FAIR_SOL}–${PACK_NFT_MAX_FAIR_SOL}) required`,
        },
        { status: 400 }
      )
    }
    try {
       
      new PublicKey(mint)
    } catch {
      return NextResponse.json({ error: 'Invalid mint address' }, { status: 400 })
    }

    const prizeStandardRaw = body.prize_standard
    const prize_standard = prizeStandardRaw == null || prizeStandardRaw === ''
      ? 'spl'
      : prizeStandardRaw
    if (!isPackInventoryPrizeStandard(prize_standard)) {
      return NextResponse.json(
        { error: 'prize_standard must be spl, mpl_core, or compressed' },
        { status: 400 }
      )
    }

    const oddsTierRaw = body.odds_tier
    const odds_tier =
      oddsTierRaw == null || oddsTierRaw === ''
        ? 'standard'
        : oddsTierRaw
    if (!isPackNftOddsTier(odds_tier)) {
      return NextResponse.json(
        { error: 'odds_tier must be standard or premium_1pct' },
        { status: 400 }
      )
    }

    let productId =
      typeof body.product_id === 'string' ? body.product_id.trim() : ''
    if (!productId && typeof body.product_slug === 'string') {
      const bySlug = await getPackProductBySlug(body.product_slug.trim())
      productId = bySlug?.id ?? ''
    }
    if (!productId) {
      const main = await getActivePackProduct()
      productId = main?.id ?? ''
    }
    if (!productId) {
      return NextResponse.json({ error: 'product_id or active pack product required' }, { status: 400 })
    }

    const row = await addPackInventoryNft({
      product_id: productId,
      mint_address: mint,
      name: typeof body.name === 'string' ? body.name : null,
      image_url: typeof body.image_url === 'string' ? body.image_url : null,
      fair_value_sol: fair,
      prize_standard,
      odds_tier,
    })
    return NextResponse.json({ ok: true, item: row })
  } catch (e) {
    console.error('[admin packs] POST inventory', e)
    const msg = e instanceof Error ? e.message : 'Failed to add NFT'
    if (/pack_inventory_mint_available|duplicate key/i.test(msg)) {
      return NextResponse.json(
        { error: 'That mint is already available or reserved in inventory' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const id = request.nextUrl.searchParams.get('id')?.trim()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await removePackInventoryNft(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin packs] DELETE', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Delete failed' },
      { status: 400 }
    )
  }
}
