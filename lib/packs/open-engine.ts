import {
  PACK_PRICE_OWL,
  PACK_PRICE_SOL,
  PACK_OPEN_ALGO_V1,
  solToLamports,
  type PackPaymentCurrency,
} from '@/lib/packs/config'
import {
  packJackpotContributionForPrice,
  PACK_JACKPOT_MIN_PAYOUT_SOL,
} from '@/lib/packs/jackpot'
import {
  countAvailableNfts,
  createPendingPackOpen,
  getPackOpenById,
  getPackOpenByPaymentSignature,
  getPackProductById,
  getPackProductForCheckout,
  getPackVaultConfig,
  listAvailableNftsForOpen,
  markNftPaid,
  releaseNftReservation,
  reserveNftById,
  resolvePackJackpotForOpen,
  updatePackOpen,
  updatePackProduct,
} from '@/lib/packs/db'
import {
  packNftMinFairSolForProductSlug,
  packOwlCheckoutTicketSolEquiv,
  resolvePackCashLadders,
  resolvePackCategoryWeightsBps,
} from '@/lib/packs/product-pools'
import type { PackProductRow } from '@/lib/packs/types'
import {
  generatePackOpenSeed,
  hashPackOpenCommit,
  pickCategory,
  pickJackpotWin,
  pickNftFromAvailableInventory,
  pickTier,
} from '@/lib/packs/rng'
import { nftPoolSnapshotForStorage } from '@/lib/packs/nft-weights'
import type {
  PackInventoryPrizeStandard,
  PackNftPoolSnapshotRow,
  PackOpenResult,
  PackOpenRow,
} from '@/lib/packs/types'
import { verifyPackOwlPayment, verifyPackPayment } from '@/lib/packs/verify-payment'
import {
  getPacksVaultPublicKey,
  payoutNftFromPacksVault,
  payoutOwlFromPacksVault,
  payoutSolFromPacksVault,
} from '@/lib/packs/vault'
import { isPackVrfEnabled, resolvePackOpenAlgo } from '@/lib/packs/vrf-config'
import { runPackOpenVrf } from '@/lib/packs/vrf-open-flow'
import { resolvePackSeedFromVrfResult } from '@/lib/packs/seed-after-payment'
import { logVrfPhase, vrfPhaseTimer } from '@/lib/raffles/draw/vrf-timing-log'
import { isPackOwlCheckoutEnabled } from '@/lib/db/pack-public-settings'
import { quotePackOwlCheckoutFee } from '@/lib/packs/owl-checkout-fee'
import { isOwlEnabled } from '@/lib/tokens'

function rowToResult(
  row: PackOpenRow,
  extra?: {
    nftName?: string | null
    nftImageUrl?: string | null
    jackpotPoolSol?: number | null
  }
): PackOpenResult {
  return {
    openId: row.id,
    category: row.category!,
    prizeLabel: row.prize_label ?? 'Prize',
    owlAmount: row.owl_amount,
    solAmount: row.sol_amount,
    nftMint: row.nft_mint_address,
    nftName: extra?.nftName ?? null,
    nftImageUrl: extra?.nftImageUrl ?? null,
    fairValueSol: row.fair_value_sol ?? 0,
    freeTicketCredits: row.free_ticket_credits,
    payoutSignature: row.payout_signature,
    openSeed: row.open_seed!,
    openCommitHash: row.open_commit_hash!,
    openAlgo: row.open_algo,
    isJackpotWin: row.is_jackpot_win === true,
    jackpotAmountSol: row.jackpot_amount_sol,
    jackpotPoolSol: extra?.jackpotPoolSol ?? null,
  }
}

export async function ensureProductShelfReady(
  product: PackProductRow
): Promise<{ ok: boolean; reason?: string }> {
  const config = await getPackVaultConfig()
  if (config.paused) {
    return { ok: false, reason: config.pause_reason || 'Packs are paused' }
  }
  if (product.shelf_paused) {
    return {
      ok: false,
      reason: product.shelf_pause_reason || 'This pack shelf is temporarily unavailable',
    }
  }
  const minNft = Number(product.min_nft_count ?? config.min_nft_count ?? 1)
  const nftCount = await countAvailableNfts(product.id)
  if (nftCount < minNft) {
    return {
      ok: false,
      reason: `Need at least ${minNft} prize NFT(s) on this shelf (have ${nftCount})`,
    }
  }
  const vault = getPacksVaultPublicKey()
  if (!vault) {
    return { ok: false, reason: 'Packs vault is not configured' }
  }
  return { ok: true }
}

async function pauseProductShelf(productId: string, reason: string): Promise<void> {
  await updatePackProduct(productId, {
    shelf_paused: true,
    shelf_pause_reason: reason,
  })
}

/** After an open completes, re-check shelf inventory without pausing other products. */
export async function ensureProductShelfAfterOpen(productId: string): Promise<void> {
  const product = await getPackProductById(productId)
  if (!product) return
  const config = await getPackVaultConfig()
  const minNft = Number(product.min_nft_count ?? config.min_nft_count ?? 1)
  const nftCount = await countAvailableNfts(productId)
  if (nftCount < minNft && !product.shelf_paused) {
    await pauseProductShelf(
      productId,
      `Low NFT inventory on this shelf (${nftCount} < min ${minNft})`
    )
  }
}

export async function startPackOpen(
  buyerWallet: string,
  options?: { currency?: PackPaymentCurrency }
): Promise<{
  openId: string
  priceSol: number
  vault: string
  currency: PackPaymentCurrency
  priceOwl?: number
  feeLamports?: string
  feeSol?: number
  solUsdPrice?: number
}> {
  const currency: PackPaymentCurrency = options?.currency === 'OWL' ? 'OWL' : 'SOL'
  const product = await getPackProductForCheckout(currency)
  if (!product) {
    throw new Error('No active pack product for this checkout path (apply migration 247)')
  }
  const shelf = await ensureProductShelfReady(product)
  if (!shelf.ok) {
    throw new Error(shelf.reason || 'Packs unavailable')
  }
  const vault = getPacksVaultPublicKey()
  if (!vault) throw new Error('Packs vault is not configured')

  const priceSol = Number(product.price_sol) || PACK_PRICE_SOL

  if (currency === 'OWL') {
    if (!isOwlEnabled()) {
      throw new Error('$OWL checkout is not configured')
    }
    if (!(await isPackOwlCheckoutEnabled())) {
      throw new Error('$OWL checkout is not enabled yet')
    }
    const feeQuote = await quotePackOwlCheckoutFee()
    if (!feeQuote || feeQuote.feeLamports <= 0n) {
      throw new Error('Could not quote $OWL SOL fee — try again in a moment')
    }
    const open = await createPendingPackOpen({
      productId: product.id,
      buyerWallet,
      paymentCurrency: 'OWL',
      paymentOwlAmount: PACK_PRICE_OWL,
      paymentFeeSol: feeQuote.feeSol,
    })
    return {
      openId: open.id,
      priceSol,
      vault,
      currency: 'OWL',
      priceOwl: PACK_PRICE_OWL,
      feeLamports: feeQuote.feeLamports.toString(),
      feeSol: feeQuote.feeSol,
      solUsdPrice: feeQuote.solUsdPrice,
    }
  }

  const open = await createPendingPackOpen({
    productId: product.id,
    buyerWallet,
    paymentCurrency: 'SOL',
  })
  return {
    openId: open.id,
    priceSol,
    vault,
    currency: 'SOL',
  }
}

/**
 * Verify payment signature and run roll → reserve → payout → receipt.
 * Idempotent on payment_signature / completed opens.
 * Seed source: Switchboard VRF by default; local commit–reveal when PACK_VRF_ENABLED=false.
 */
export async function confirmAndOpenPack(input: {
  openId: string
  buyerWallet: string
  paymentSignature: string
}): Promise<PackOpenResult> {
  const openWall = vrfPhaseTimer()
  const existingBySig = await getPackOpenByPaymentSignature(input.paymentSignature)
  if (existingBySig?.status === 'completed' && existingBySig.open_seed) {
    return rowToResult(existingBySig)
  }

  let open = await getPackOpenById(input.openId)
  if (!open) throw new Error('Pack open not found')
  if (open.buyer_wallet.trim().toLowerCase() !== input.buyerWallet.trim().toLowerCase()) {
    throw new Error('Wallet does not match this pack open')
  }
  if (open.status === 'completed' && open.open_seed) {
    return rowToResult(open)
  }

  const openProduct =
    (await getPackProductById(open.product_id)) ?? (await getPackProductForCheckout('SOL'))
  if (!openProduct) throw new Error('Pack product not found for this open')
  const priceSol = Number(openProduct.price_sol) || PACK_PRICE_SOL
  const paymentCurrency: PackPaymentCurrency =
    open.payment_currency === 'OWL' ? 'OWL' : 'SOL'

  const verifyPhase = vrfPhaseTimer()
  const verified =
    paymentCurrency === 'OWL'
      ? await verifyPackOwlPayment({
          signature: input.paymentSignature,
          buyerWallet: input.buyerWallet,
          expectedOwl: Number(open.payment_owl_amount) || PACK_PRICE_OWL,
          expectedFeeSol: Number(open.payment_fee_sol) || 0,
        })
      : await verifyPackPayment({
          signature: input.paymentSignature,
          buyerWallet: input.buyerWallet,
          expectedSol: priceSol,
        })
  logVrfPhase('pack', 'open.verify_payment', verifyPhase.elapsed(), {
    openId: open.id,
    currency: paymentCurrency,
    ok: verified.ok,
  })
  if (!verified.ok) {
    await updatePackOpen(open.id, {
      status: 'failed',
      error_message: verified.error,
      payment_signature: input.paymentSignature,
    })
    throw new Error(verified.error)
  }

  try {
    open = await updatePackOpen(open.id, {
      status: 'paid',
      payment_signature: input.paymentSignature,
      error_message: null,
    })
  } catch (e) {
    const again = await getPackOpenByPaymentSignature(input.paymentSignature)
    if (again?.status === 'completed' && again.open_seed) return rowToResult(again)
    throw e
  }

  const config = await getPackVaultConfig()
  const cashLadders = resolvePackCashLadders(openProduct.slug, config.owl_sol_price)
  let algo = resolvePackOpenAlgo()

  let seed: string
  if (isPackVrfEnabled()) {
    open = await updatePackOpen(open.id, { status: 'rolling', open_algo: algo })
    const vrfPhase = vrfPhaseTimer()
    const vrf = await runPackOpenVrf(open.id)
    logVrfPhase('pack', 'open.vrf', vrfPhase.elapsed(), {
      openId: open.id,
      ok: vrf.ok,
    })
    const resolved = resolvePackSeedFromVrfResult({
      vrfOk: vrf.ok,
      vrfOpenSeed: vrf.ok ? vrf.openSeed : undefined,
      vrfError: vrf.ok ? undefined : vrf.error,
      localSeed: generatePackOpenSeed(),
    })
    seed = resolved.seed
    algo = resolved.algo
    if (resolved.usedVrfFallback) {
      // Payment already confirmed — never leave the buyer without a rip.
      console.error(
        '[packs] Switchboard VRF failed after payment; completing with local seed fallback',
        resolved.vrfError
      )
      await updatePackOpen(open.id, {
        open_algo: PACK_OPEN_ALGO_V1,
        open_vrf_status: 'failed',
        open_vrf_error: `VRF failed; completed with local seed fallback: ${resolved.vrfError}`,
        error_message: null,
      } as Parameters<typeof updatePackOpen>[1])
    }
  } else {
    seed = generatePackOpenSeed()
  }

  const commit = hashPackOpenCommit(seed)
  open = await updatePackOpen(open.id, {
    status: 'rolling',
    open_algo: algo,
    open_seed: seed,
    open_commit_hash: commit,
  })

  const ticketSolForJackpot =
    paymentCurrency === 'OWL'
      ? packOwlCheckoutTicketSolEquiv({
          owlSolPrice: config.owl_sol_price,
          paymentFeeSol: Number(open.payment_fee_sol) || 0,
          paymentOwlAmount: Number(open.payment_owl_amount) || PACK_PRICE_OWL,
        })
      : priceSol

  const productJackpotContribution =
    openProduct.jackpot_contribution_sol != null &&
    Number(openProduct.jackpot_contribution_sol) > 0
      ? Number(openProduct.jackpot_contribution_sol)
      : Number(config.jackpot_contribution_sol) > 0
        ? Number(config.jackpot_contribution_sol)
        : packJackpotContributionForPrice(ticketSolForJackpot)
  const jackpotContribution = productJackpotContribution
  const jackpotOddsBps =
    Number(openProduct.jackpot_win_odds_bps ?? config.jackpot_win_odds_bps) || 20
  const poolBeforeJackpot = Number(openProduct.jackpot_pool_sol ?? 0)
  const poolAfterContribution =
    Math.round((poolBeforeJackpot + jackpotContribution) * 1_000_000_000) / 1_000_000_000
  const jackpotRollWins =
    pickJackpotWin(seed, jackpotOddsBps) &&
    poolAfterContribution >= PACK_JACKPOT_MIN_PAYOUT_SOL

  const jackpotResolution = await resolvePackJackpotForOpen({
    productId: openProduct.id,
    contributionSol: jackpotContribution,
    won: jackpotRollWins,
  })

  if (jackpotRollWins && jackpotResolution.jackpotPayoutSol != null) {
    const jackpotAmount = jackpotResolution.jackpotPayoutSol
    open = await updatePackOpen(open.id, {
      status: 'reserved',
      category: 'jackpot',
      prize_label: `${jackpotAmount} SOL Jackpot`,
      owl_amount: null,
      sol_amount: jackpotAmount,
      nft_inventory_id: null,
      nft_mint_address: null,
      fair_value_sol: jackpotAmount,
      free_ticket_credits: 0,
      is_jackpot_win: true,
      jackpot_contribution_sol: jackpotContribution,
      jackpot_amount_sol: jackpotAmount,
      nft_pool_snapshot: null,
    })

    open = await updatePackOpen(open.id, { status: 'paying_out' })

    const paid = await payoutSolFromPacksVault(
      input.buyerWallet,
      solToLamports(jackpotAmount)
    )
    if (!paid.ok || !paid.signature) {
      await updatePackOpen(open.id, {
        status: 'refund_needed',
        error_message: paid.error || 'Jackpot SOL payout failed',
      })
      throw new Error(paid.error || 'Jackpot payout failed')
    }

    open = await updatePackOpen(open.id, {
      status: 'completed',
      payout_signature: paid.signature,
      completed_at: new Date().toISOString(),
      error_message: null,
    })

    await ensureProductShelfAfterOpen(openProduct.id)

    logVrfPhase('pack', 'open.total', openWall.elapsed(), {
      openId: open.id,
      category: 'jackpot',
      vrf: isPackVrfEnabled(),
    })

    return rowToResult(open, { jackpotPoolSol: jackpotResolution.poolAfterSol })
  }

  const categoryWeights = resolvePackCategoryWeightsBps(openProduct.slug)
  const category = pickCategory(seed, categoryWeights)

  let prizeLabel = ''
  let owlAmount: number | null = null
  let solAmount: number | null = null
  let fairValueSol = 0
  let nftInventoryId: string | null = null
  let nftMint: string | null = null
  let nftName: string | null = null
  let nftImageUrl: string | null = null
  let nftPrizeStandard: PackInventoryPrizeStandard | null = null
  let nftPoolSnapshot: PackNftPoolSnapshotRow[] | null = null

  if (category === 'owl') {
    const pick = pickTier(seed, 'owl', config.owl_sol_price, cashLadders)
    if (pick.category !== 'owl') throw new Error('Invalid OWL pick')
    owlAmount = pick.amount
    fairValueSol = pick.fairValueSol
    prizeLabel = `${pick.amount} $OWL`
  } else if (category === 'sol') {
    const pick = pickTier(seed, 'sol', config.owl_sol_price, cashLadders)
    if (pick.category !== 'sol') throw new Error('Invalid SOL pick')
    solAmount = pick.amountSol
    fairValueSol = pick.fairValueSol
    prizeLabel = `${pick.amountSol} SOL`
  } else {
    const available = await listAvailableNftsForOpen(openProduct.id)
    if (available.length === 0) {
      await pauseProductShelf(openProduct.id, 'NFT inventory empty during open — shelf paused')
      open = await updatePackOpen(open.id, {
        status: 'refund_needed',
        category: 'nft',
        error_message: 'No NFT inventory available for payout',
      })
      throw new Error('No NFT inventory on this shelf. Contact support for refund.')
    }

    const nftMinFair = packNftMinFairSolForProductSlug(openProduct.slug)
    const { pick, pool } = pickNftFromAvailableInventory(
      seed,
      available.map((r) => ({
        id: r.id,
        mint_address: r.mint_address,
        fair_value_sol: Number(r.fair_value_sol),
        name: r.name,
        image_url: r.image_url,
        odds_tier: r.odds_tier === 'premium_1pct' ? 'premium_1pct' : 'standard',
      })),
      { minFairSol: nftMinFair }
    )
    nftPoolSnapshot = nftPoolSnapshotForStorage(pool)

    const reserved = await reserveNftById(open.id, pick.id)
    if (!reserved) {
      // Race: mint taken between list and reserve — soft retry once with refreshed pool
      const available2 = await listAvailableNftsForOpen(openProduct.id)
      if (available2.length === 0) {
        await pauseProductShelf(openProduct.id, 'NFT inventory empty during open — shelf paused')
        open = await updatePackOpen(open.id, {
          status: 'refund_needed',
          category: 'nft',
          error_message: 'No NFT inventory available for payout',
          nft_pool_snapshot: nftPoolSnapshot,
        })
        throw new Error('No NFT inventory on this shelf. Contact support for refund.')
      }
      const second = pickNftFromAvailableInventory(
        seed,
        available2.map((r) => ({
          id: r.id,
          mint_address: r.mint_address,
          fair_value_sol: Number(r.fair_value_sol),
          name: r.name,
          image_url: r.image_url,
          odds_tier: r.odds_tier === 'premium_1pct' ? 'premium_1pct' : 'standard',
        })),
        { minFairSol: nftMinFair }
      )
      nftPoolSnapshot = nftPoolSnapshotForStorage(second.pool)
      const reserved2 = await reserveNftById(open.id, second.pick.id)
      if (!reserved2) {
        open = await updatePackOpen(open.id, {
          status: 'refund_needed',
          category: 'nft',
          error_message: 'Could not reserve NFT (concurrent opens)',
          nft_pool_snapshot: nftPoolSnapshot,
        })
        throw new Error('Could not reserve NFT prize. Contact support for refund.')
      }
      nftInventoryId = reserved2.id
      nftMint = reserved2.mint_address
      nftName = reserved2.name
      nftImageUrl = reserved2.image_url
      nftPrizeStandard = reserved2.prize_standard ?? 'spl'
      fairValueSol = Number(reserved2.fair_value_sol)
      prizeLabel = reserved2.name || `NFT ${reserved2.mint_address.slice(0, 8)}…`
    } else {
      nftInventoryId = reserved.id
      nftMint = reserved.mint_address
      nftName = reserved.name
      nftImageUrl = reserved.image_url
      nftPrizeStandard = reserved.prize_standard ?? 'spl'
      fairValueSol = Number(reserved.fair_value_sol)
      prizeLabel = reserved.name || `NFT ${reserved.mint_address.slice(0, 8)}…`
    }
  }

  open = await updatePackOpen(open.id, {
    status: 'reserved',
    category,
    prize_label: prizeLabel,
    owl_amount: owlAmount,
    sol_amount: solAmount,
    nft_inventory_id: nftInventoryId,
    nft_mint_address: nftMint,
    fair_value_sol: fairValueSol,
    free_ticket_credits: 0,
    is_jackpot_win: false,
    jackpot_contribution_sol: jackpotContribution,
    jackpot_amount_sol: null,
    nft_pool_snapshot: nftPoolSnapshot,
  })

  open = await updatePackOpen(open.id, { status: 'paying_out' })

  let payoutSignature: string | null = null
  try {
    if (category === 'owl' && owlAmount != null) {
      const paid = await payoutOwlFromPacksVault(input.buyerWallet, owlAmount)
      if (!paid.ok || !paid.signature) {
        throw new Error(paid.error || 'OWL payout failed')
      }
      payoutSignature = paid.signature
    } else if (category === 'sol' && solAmount != null) {
      const paid = await payoutSolFromPacksVault(input.buyerWallet, solToLamports(solAmount))
      if (!paid.ok || !paid.signature) {
        throw new Error(paid.error || 'SOL payout failed')
      }
      payoutSignature = paid.signature
    } else if (category === 'nft' && nftMint && nftInventoryId) {
      const paid = await payoutNftFromPacksVault(nftMint, input.buyerWallet, nftPrizeStandard)
      if (!paid.ok || !paid.signature) {
        await releaseNftReservation(nftInventoryId)
        throw new Error(paid.error || 'NFT payout failed')
      }
      payoutSignature = paid.signature
      await markNftPaid(nftInventoryId, open.id, paid.signature)
    } else {
      throw new Error('Invalid prize state for payout')
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (nftInventoryId) {
      try {
        await releaseNftReservation(nftInventoryId)
      } catch {
        // ignore
      }
    }
    await updatePackOpen(open.id, {
      status: 'refund_needed',
      error_message: msg,
    })
    throw e
  }

  open = await updatePackOpen(open.id, {
    status: 'completed',
    payout_signature: payoutSignature,
    completed_at: new Date().toISOString(),
    error_message: null,
  })

  await ensureProductShelfAfterOpen(openProduct.id)

  logVrfPhase('pack', 'open.total', openWall.elapsed(), {
    openId: open.id,
    category: open.category,
    vrf: isPackVrfEnabled(),
  })

  return rowToResult(open, {
    nftName,
    nftImageUrl,
    jackpotPoolSol: jackpotResolution.poolAfterSol,
  })
}
