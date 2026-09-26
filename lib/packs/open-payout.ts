import {
  getPackProductById,
  markNftPaid,
  releaseNftReservation,
  updatePackOpen,
} from '@/lib/packs/db'
import { solToLamports } from '@/lib/packs/config'
import { getPackInventoryById } from '@/lib/packs/db'
import { detectPackPayoutAlreadyLanded } from '@/lib/packs/payout-verify'
import { ensureProductShelfAfterOpen } from '@/lib/packs/shelf'
import type { PackInventoryPrizeStandard, PackOpenResult, PackOpenRow } from '@/lib/packs/types'
import {
  payoutNftFromPacksVault,
  payoutOwlFromPacksVault,
  payoutSolFromPacksVault,
  type PackVaultPayoutResult,
} from '@/lib/packs/vault'

function rowToMinimalResult(row: PackOpenRow): PackOpenResult {
  return {
    openId: row.id,
    category: row.category!,
    prizeLabel: row.prize_label ?? 'Prize',
    owlAmount: row.owl_amount,
    solAmount: row.sol_amount,
    nftMint: row.nft_mint_address,
    nftName: null,
    nftImageUrl: null,
    fairValueSol: row.fair_value_sol ?? 0,
    freeTicketCredits: row.free_ticket_credits,
    payoutSignature: row.payout_signature,
    openSeed: row.open_seed!,
    openCommitHash: row.open_commit_hash!,
    openAlgo: row.open_algo,
    isJackpotWin: row.is_jackpot_win === true,
    jackpotAmountSol: row.jackpot_amount_sol,
    jackpotPoolSol: null,
  }
}

async function completeOpenRow(
  open: PackOpenRow,
  payoutSignature: string,
  extra?: { nftName?: string | null; nftImageUrl?: string | null }
): Promise<PackOpenRow> {
  const completed = await updatePackOpen(open.id, {
    status: 'completed',
    payout_signature: payoutSignature,
    completed_at: new Date().toISOString(),
    error_message: null,
  })
  await ensureProductShelfAfterOpen(open.product_id)
  return { ...completed, ...extra } as PackOpenRow
}

async function markRefundNeeded(open: PackOpenRow, message: string): Promise<void> {
  await updatePackOpen(open.id, {
    status: 'refund_needed',
    error_message: message,
  })
}

async function executeVaultPayoutForOpen(
  open: PackOpenRow,
  buyerWallet: string,
  nftPrizeStandard?: PackInventoryPrizeStandard | null
): Promise<PackVaultPayoutResult | { ok: true; signature: string }> {
  const category = open.category
  if (category === 'owl' && open.owl_amount != null) {
    return payoutOwlFromPacksVault(buyerWallet, open.owl_amount)
  }
  if ((category === 'sol' || category === 'jackpot') && open.sol_amount != null) {
    return payoutSolFromPacksVault(buyerWallet, solToLamports(open.sol_amount))
  }
  if (category === 'jackpot' && open.jackpot_amount_sol != null) {
    return payoutSolFromPacksVault(buyerWallet, solToLamports(open.jackpot_amount_sol))
  }
  if (category === 'nft' && open.nft_mint_address) {
    const paid = await payoutNftFromPacksVault(
      open.nft_mint_address,
      buyerWallet,
      nftPrizeStandard
    )
    return paid.ok
      ? { ok: true, signature: paid.signature! }
      : { ok: false, error: paid.error || 'NFT payout failed' }
  }
  return { ok: false, error: 'Invalid prize state for payout' }
}

/**
 * Pay the stored prize for an open that already has a committed roll (open_seed).
 * Idempotent when payout already landed on-chain.
 */
export async function payoutCommittedPackOpen(input: {
  open: PackOpenRow
  buyerWallet: string
}): Promise<PackOpenResult> {
  let open = input.open
  if (!open.open_seed || !open.open_commit_hash || !open.category) {
    throw new Error('Pack open has no committed prize to pay out')
  }

  const landed = await detectPackPayoutAlreadyLanded(open)
  if (landed.landed && landed.signature) {
    open = await completeOpenRow(open, landed.signature)
    return rowToMinimalResult(open)
  }

  let nftPrizeStandard: PackInventoryPrizeStandard | null = null
  let nftName: string | null = null
  let nftImageUrl: string | null = null
  if (open.category === 'nft' && open.nft_inventory_id) {
    const inv = await getPackInventoryById(open.nft_inventory_id)
    nftPrizeStandard = inv?.prize_standard ?? 'spl'
    nftName = inv?.name ?? null
    nftImageUrl = inv?.image_url ?? null
  }

  open = await updatePackOpen(open.id, { status: 'paying_out' })

  const paid = await executeVaultPayoutForOpen(open, input.buyerWallet.trim(), nftPrizeStandard)

  if (!paid.ok) {
    const withSig = open.payout_signature ?? paid.signature
    if (withSig) {
      open = await updatePackOpen(open.id, { payout_signature: withSig })
    }
    const recheck = await detectPackPayoutAlreadyLanded(open)
    if (recheck.landed && recheck.signature) {
      if (open.category === 'nft' && open.nft_inventory_id) {
        await markNftPaid(open.nft_inventory_id, open.id, recheck.signature)
      }
      open = await completeOpenRow(open, recheck.signature, { nftName, nftImageUrl })
      return rowToMinimalResult(open)
    }
    if (open.nft_inventory_id && open.category === 'nft') {
      try {
        await releaseNftReservation(open.nft_inventory_id)
      } catch {
        // ignore
      }
    }
    await markRefundNeeded(open, paid.error || 'Payout failed')
    throw new Error(paid.error || 'Payout failed')
  }

  if (open.category === 'nft' && open.nft_inventory_id && paid.signature) {
    await markNftPaid(open.nft_inventory_id, open.id, paid.signature)
  }

  open = await completeOpenRow(open, paid.signature, { nftName, nftImageUrl })
  return rowToMinimalResult(open)
}

/** Admin / support: mark completed when payout or refund tx was sent manually. */
export async function recordManualPackOpenResolution(input: {
  open: PackOpenRow
  payoutSignature: string
  resolution: 'prize_paid' | 'refund'
}): Promise<PackOpenResult> {
  const sig = input.payoutSignature.trim()
  if (!sig) throw new Error('payoutSignature is required')

  let open = input.open
  open = await updatePackOpen(open.id, {
    status: 'completed',
    payout_signature: sig,
    completed_at: new Date().toISOString(),
    error_message:
      input.resolution === 'refund'
        ? `Manual refund recorded by admin (${sig})`
        : null,
  })
  await ensureProductShelfAfterOpen(open.product_id)
  const product = await getPackProductById(open.product_id)
  void product
  return rowToMinimalResult(open)
}
