import {
  recordMintSessionConfirms,
  resolveMintSessionOutcome,
  type MintConfirmBatchPayload,
} from '@/lib/owl-center/mint-session'
import { mintConfirmBackgroundBudgetMs, raceMintSessionBudget, createMintSessionDeadline } from '@/lib/owl-center/mint-time-budget'
import type { MintGen2Result } from '@/lib/solana/gen2-mint'

export type MintConfirmFailure = {
  /** Raw error message from the confirm route / recorder. */
  message: string
  /**
   * True when the server's on-chain verify proved the tx did NOT mint an NFT (bot-tax only / failed
   * tx). For these, the optimistic "You minted N!" overlay is wrong and must be downgraded. Soft
   * failures (RPC lag, save timeout) likely DID land and are left to the beacon/cron reconcile.
   */
  hardFailure: boolean
}

/**
 * Phrases the confirm route returns when the chain verify proves no NFT was minted. Matched
 * loosely (case-insensitive substring) so a copy tweak on the route doesn't silently re-break the
 * downgrade. Keep in sync with the `no_nft_minted` / `failed` messages in confirm-mint/route.ts.
 */
const HARD_CONFIRM_FAILURE_PATTERNS = [
  'no nft was minted',
  'the mint did not go through',
  'mint transaction failed on-chain',
]

export function isHardMintConfirmFailure(message: string): boolean {
  const low = message.toLowerCase()
  return HARD_CONFIRM_FAILURE_PATTERNS.some((p) => low.includes(p))
}

export type OptimisticMintFinalizeArgs = {
  minted: MintGen2Result
  requestedQuantity: number
  confirmBatch: (payload: MintConfirmBatchPayload) => Promise<void>
  onSuccess: (args: {
    lastSig: string | null
    mintedAddresses: string[]
    mintedCount: number
    warning: string | null
  }) => void
  /** Fires when the background DB record fails. `hardFailure` flags a proven did-not-mint tx. */
  onRecordWarning?: (failure: MintConfirmFailure) => void
  /** Fires after the background DB record completes — safe point to reconcile server eligibility. */
  onRecordSuccess?: () => void
}

/** Show mint success as soon as the chain tx is done; record to DB in the background (≤12s). */
export function finalizeMintSessionOptimistic(args: OptimisticMintFinalizeArgs): void {
  const { minted, requestedQuantity, confirmBatch, onSuccess, onRecordWarning, onRecordSuccess } = args

  const sigs = minted.ok ? minted.txSignatures : (minted.txSignatures ?? [])
  const mintPks = minted.ok ? minted.mintedNftMints : (minted.mintedNftMints ?? [])

  if (!minted.ok && mintPks.length === 0 && sigs.length === 0) {
    throw new Error(minted.error || 'mint_failed')
  }

  const outcome = resolveMintSessionOutcome(minted, requestedQuantity)
  if ('error' in outcome) {
    throw new Error(outcome.error)
  }

  onSuccess({
    lastSig: outcome.lastSig,
    mintedAddresses: outcome.mintedAddresses,
    mintedCount: outcome.mintedCount,
    warning: outcome.warning,
  })

  const confirmDeadline = createMintSessionDeadline(mintConfirmBackgroundBudgetMs(sigs.length))
  void (async () => {
    try {
      await raceMintSessionBudget(
        confirmDeadline,
        recordMintSessionConfirms(sigs, mintPks, confirmBatch),
        'Saving mint timed out'
      )
      onRecordSuccess?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'confirm_failed'
      onRecordWarning?.({ message: msg, hardFailure: isHardMintConfirmFailure(msg) })
    }
  })()
}
