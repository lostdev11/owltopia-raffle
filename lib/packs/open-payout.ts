import {
  getPackProductById,
  markNftPaid,
  releaseOrQuarantineNftAfterPayoutFailure,
  updatePackOpen,
} from '@/lib/packs/db'
import { solToLamports } from '@/lib/packs/config'
import { getPackInventoryById } from '@/lib/packs/db'
import { detectPackPayoutAlreadyLanded } from '@/lib/packs/payout-verify'
import { ensureProductShelfAfterOpen } from '@/lib/packs/shelf'
import { PackOpenRetryableError } from '@/lib/packs/pack-open-errors'
import {
  isPackPayoutTransientError,
  isPackVaultPayoutResultRetryable,
} from '@/lib/packs/payout-transient'
import type { PackInventoryPrizeStandard, PackOpenResult, PackOpenRow } from '@/lib/packs/types'
import {
  payoutNftFromPacksVault,
  payoutOwlFromPacksVault,
  payoutSolFromPacksVault,
  type PackVaultPayoutResult,
  type PackVaultSendHooks,
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

async function persistPayoutSignatureSent(openId: string, signature: string): Promise<void> {
  await updatePackOpen(openId, { payout_signature: signature })
}

async function handleNftPayoutFailure(
  open: PackOpenRow,
  errorMessage: string
): Promise<void> {
  if (!open.nft_inventory_id || open.category !== 'nft') return
  try {
    await releaseOrQuarantineNftAfterPayoutFailure({
      inventoryId: open.nft_inventory_id,
      reason: errorMessage,
    })
  } catch (e) {
    console.error('[packs/open-payout] release/quarantine failed', e)
  }
}

async function executeVaultPayoutForOpen(
  open: PackOpenRow,
  buyerWallet: string,
  nftPrizeStandard?: PackInventoryPrizeStandard | null,
  hooks?: PackVaultSendHooks
): Promise<PackVaultPayoutResult | { ok: true; signature: string }> {
  const category = open.category
  if (category === 'owl' && open.owl_amount != null) {
    return payoutOwlFromPacksVault(buyerWallet, open.owl_amount, hooks)
  }
  if ((category === 'sol' || category === 'jackpot') && open.sol_amount != null) {
    return payoutSolFromPacksVault(buyerWallet, solToLamports(open.sol_amount), hooks)
  }
  if (category === 'jackpot' && open.jackpot_amount_sol != null) {
    return payoutSolFromPacksVault(buyerWallet, solToLamports(open.jackpot_amount_sol), hooks)
  }
  if (category === 'nft' && open.nft_mint_address) {
    const paid = await payoutNftFromPacksVault(
      open.nft_mint_address,
      buyerWallet,
      nftPrizeStandard,
      hooks
    )
    if (paid.ok) {
      return { ok: true, signature: paid.signature! }
    }
    return {
      ok: false,
      error: paid.error || 'NFT payout failed',
      signature: paid.signature,
      confirmUncertain: paid.confirmUncertain,
    }
  }
  return { ok: false, error: 'Invalid prize state for payout' }
}

async function finalizeAfterVaultAttempt(input: {
  open: PackOpenRow
  buyerWallet: string
  paid: PackVaultPayoutResult | { ok: true; signature: string }
  nftName: string | null
  nftImageUrl: string | null
}): Promise<PackOpenResult> {
  let open = input.open
  const paid = input.paid

  if (paid.ok) {
    if (open.category === 'nft' && open.nft_inventory_id && paid.signature) {
      await markNftPaid(open.nft_inventory_id, open.id, paid.signature)
    }
    open = await completeOpenRow(open, paid.signature, {
      nftName: input.nftName,
      nftImageUrl: input.nftImageUrl,
    })
    return rowToMinimalResult(open)
  }

  const withSig = open.payout_signature ?? paid.signature
  if (withSig) {
    open = await updatePackOpen(open.id, { payout_signature: withSig })
  }

  const recheck = await detectPackPayoutAlreadyLanded(open)
  if (recheck.landed && recheck.signature) {
    if (open.category === 'nft' && open.nft_inventory_id) {
      await markNftPaid(open.nft_inventory_id, open.id, recheck.signature)
    }
    open = await completeOpenRow(open, recheck.signature, {
      nftName: input.nftName,
      nftImageUrl: input.nftImageUrl,
    })
    return rowToMinimalResult(open)
  }

  const errMsg = paid.error || 'Payout failed'

  if (isPackVaultPayoutResultRetryable(paid)) {
    await updatePackOpen(open.id, {
      status: 'paying_out',
      error_message: errMsg,
    })
    throw new PackOpenRetryableError(errMsg)
  }

  if (open.nft_inventory_id && open.category === 'nft') {
    await handleNftPayoutFailure(open, errMsg)
  }
  await markRefundNeeded(open, errMsg)
  throw new Error(errMsg)
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

  open = await updatePackOpen(open.id, { status: 'paying_out', error_message: null })

  const sendHooks: PackVaultSendHooks = {
    onSent: (signature) => persistPayoutSignatureSent(open.id, signature),
  }

  let paid: PackVaultPayoutResult | { ok: true; signature: string }
  try {
    paid = await executeVaultPayoutForOpen(
      open,
      input.buyerWallet.trim(),
      nftPrizeStandard,
      sendHooks
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isPackPayoutTransientError(e)) {
      await updatePackOpen(open.id, {
        status: 'paying_out',
        error_message: msg,
      })
      throw new PackOpenRetryableError(msg)
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
      await handleNftPayoutFailure(open, msg)
    }
    await markRefundNeeded(open, msg)
    throw e instanceof Error ? e : new Error(msg)
  }

  return finalizeAfterVaultAttempt({
    open,
    buyerWallet: input.buyerWallet,
    paid,
    nftName,
    nftImageUrl,
  })
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
