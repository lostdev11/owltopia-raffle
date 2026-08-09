import {
  PACK_OPEN_ALGO,
  PACK_OWL_TO_TICKET_RATIO,
  PACK_PRICE_SOL,
  solToLamports,
} from '@/lib/packs/config'
import {
  countAvailableNfts,
  createPendingPackOpen,
  getActivePackProduct,
  getPackOpenById,
  getPackOpenByPaymentSignature,
  getPackVaultConfig,
  grantPackTicketCredits,
  markNftPaid,
  releaseNftReservation,
  reserveNftInBand,
  updatePackOpen,
  updatePackVaultConfig,
} from '@/lib/packs/db'
import {
  generatePackOpenSeed,
  hashPackOpenCommit,
  pickCategory,
  pickTier,
} from '@/lib/packs/rng'
import type { PackOpenResult, PackOpenRow } from '@/lib/packs/types'
import { verifyPackPayment } from '@/lib/packs/verify-payment'
import {
  getPacksVaultPublicKey,
  payoutNftFromPacksVault,
  payoutOwlFromPacksVault,
  payoutSolFromPacksVault,
} from '@/lib/packs/vault'

function rowToResult(row: PackOpenRow, extra?: { nftName?: string | null; nftImageUrl?: string | null }): PackOpenResult {
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
  }
}

export async function ensurePacksSolvencyOrPause(): Promise<{
  ok: boolean
  reason?: string
}> {
  const config = await getPackVaultConfig()
  const nftCount = await countAvailableNfts()
  if (nftCount < config.min_nft_count) {
    if (!config.paused) {
      await updatePackVaultConfig({
        paused: true,
        pause_reason: `Low NFT inventory (${nftCount} < min ${config.min_nft_count})`,
      })
    }
    return {
      ok: false,
      reason: `Packs paused: need at least ${config.min_nft_count} NFT(s) in inventory (have ${nftCount})`,
    }
  }
  if (config.paused) {
    return { ok: false, reason: config.pause_reason || 'Packs are paused' }
  }
  const vault = getPacksVaultPublicKey()
  if (!vault) {
    return { ok: false, reason: 'Packs vault is not configured' }
  }
  return { ok: true }
}

export async function startPackOpen(buyerWallet: string): Promise<{
  openId: string
  priceSol: number
  vault: string
}> {
  const solvency = await ensurePacksSolvencyOrPause()
  if (!solvency.ok) {
    throw new Error(solvency.reason || 'Packs unavailable')
  }
  const product = await getActivePackProduct()
  if (!product) {
    throw new Error('No active pack product (apply migration 212)')
  }
  const vault = getPacksVaultPublicKey()
  if (!vault) throw new Error('Packs vault is not configured')

  const open = await createPendingPackOpen({
    productId: product.id,
    buyerWallet,
  })
  return {
    openId: open.id,
    priceSol: Number(product.price_sol) || PACK_PRICE_SOL,
    vault,
  }
}

/**
 * Verify payment signature and run roll → reserve → payout → receipt.
 * Idempotent on payment_signature / completed opens.
 */
export async function confirmAndOpenPack(input: {
  openId: string
  buyerWallet: string
  paymentSignature: string
}): Promise<PackOpenResult> {
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

  const product = await getActivePackProduct()
  const priceSol = product ? Number(product.price_sol) : PACK_PRICE_SOL

  const verified = await verifyPackPayment({
    signature: input.paymentSignature,
    buyerWallet: input.buyerWallet,
    expectedSol: priceSol,
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
  const seed = generatePackOpenSeed()
  const commit = hashPackOpenCommit(seed)

  open = await updatePackOpen(open.id, {
    status: 'rolling',
    open_algo: PACK_OPEN_ALGO,
    open_seed: seed,
    open_commit_hash: commit,
  })

  const category = pickCategory(seed)
  const pick = pickTier(seed, category, config.owl_sol_price)

  let prizeLabel = ''
  let owlAmount: number | null = null
  let solAmount: number | null = null
  let fairValueSol = 0
  let nftInventoryId: string | null = null
  let nftMint: string | null = null
  let nftName: string | null = null
  let nftImageUrl: string | null = null
  let freeTickets = 0

  if (pick.category === 'owl') {
    owlAmount = pick.amount
    fairValueSol = pick.fairValueSol
    prizeLabel = `${pick.amount} $OWL`
    freeTickets = Math.floor(pick.amount * PACK_OWL_TO_TICKET_RATIO)
  } else if (pick.category === 'sol') {
    solAmount = pick.amountSol
    fairValueSol = pick.fairValueSol
    prizeLabel = `${pick.amountSol} SOL`
  } else {
    const reserved = await reserveNftInBand(open.id, pick.minFairValueSol, pick.maxFairValueSol)
    if (!reserved) {
      // Try any available NFT in full 0.05–0.5 range as soft fallback within NFT category
      const fallback = await reserveNftInBand(open.id, 0.05, 0.5)
      if (!fallback) {
        await updatePackVaultConfig({
          paused: true,
          pause_reason: 'NFT inventory empty during open — paused',
        })
        open = await updatePackOpen(open.id, {
          status: 'refund_needed',
          category: 'nft',
          error_message: 'No NFT inventory available for payout',
        })
        throw new Error('No NFT inventory available. Packs paused — contact support for refund.')
      }
      nftInventoryId = fallback.id
      nftMint = fallback.mint_address
      nftName = fallback.name
      nftImageUrl = fallback.image_url
      fairValueSol = Number(fallback.fair_value_sol)
      prizeLabel = fallback.name || `NFT ${fallback.mint_address.slice(0, 8)}…`
    } else {
      nftInventoryId = reserved.id
      nftMint = reserved.mint_address
      nftName = reserved.name
      nftImageUrl = reserved.image_url
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
    free_ticket_credits: freeTickets,
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
      await grantPackTicketCredits({
        wallet: input.buyerWallet,
        openId: open.id,
        credits: freeTickets,
      })
    } else if (category === 'sol' && solAmount != null) {
      const paid = await payoutSolFromPacksVault(input.buyerWallet, solToLamports(solAmount))
      if (!paid.ok || !paid.signature) {
        throw new Error(paid.error || 'SOL payout failed')
      }
      payoutSignature = paid.signature
    } else if (category === 'nft' && nftMint && nftInventoryId) {
      const paid = await payoutNftFromPacksVault(nftMint, input.buyerWallet)
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

  // Soft solvency check after open
  await ensurePacksSolvencyOrPause()

  return rowToResult(open, { nftName, nftImageUrl })
}
