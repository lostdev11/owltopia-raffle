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

export type RecoveredMintConfirmSuccess = {
  kind: 'success'
  count: number
  lastSig: string | null
  mintAddresses: string[]
}

export type RecoveredMintConfirmError = {
  kind: 'error'
  message: string
  hardFailure: boolean
}

export type RecoveredMintConfirmResult = RecoveredMintConfirmSuccess | RecoveredMintConfirmError

/**
 * Bound confirm for mint recovery. Always resolves to success or error — never leave the UI on
 * `recording_mint` when confirm throws or times out (CollectionMintPanel historically hung here).
 */
export async function runRecoveredMintConfirm(args: {
  sigs: string[]
  mintPks: string[]
  confirmBatch: (payload: MintConfirmBatchPayload) => Promise<void>
  onProgress?: (confirmedCount: number, totalSteps: number) => void
}): Promise<RecoveredMintConfirmResult> {
  const { sigs, mintPks, confirmBatch, onProgress } = args
  if (sigs.length === 0) {
    return {
      kind: 'error',
      message:
        'Couldn’t confirm a mint — check Collectibles in your wallet, then tap Mint to try again if it isn’t there.',
      hardFailure: false,
    }
  }

  try {
    const recordDeadline = createMintSessionDeadline(mintConfirmBackgroundBudgetMs(sigs.length))
    const recorded = await raceMintSessionBudget(
      recordDeadline,
      recordMintSessionConfirms(sigs, mintPks, confirmBatch, onProgress),
      'Saving mint timed out'
    )
    const count = recorded.confirmedCount || mintPks.length || 1
    return {
      kind: 'success',
      count,
      lastSig: recorded.lastSig ?? sigs[sigs.length - 1] ?? null,
      mintAddresses: mintPks.length ? mintPks : [],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isHardMintConfirmFailure(msg) || mintPks.length === 0) {
      return {
        kind: 'error',
        message: isHardMintConfirmFailure(msg)
          ? 'That didn’t go through — no NFT was minted (you were only charged the network + platform fee, not the mint price). Your allocation is intact; tap Mint to try again.'
          : 'Couldn’t confirm a mint — check Collectibles in your wallet, then tap Mint to try again if it isn’t there.',
        hardFailure: isHardMintConfirmFailure(msg),
      }
    }
    // Soft failure but NFTs were detected on-chain — treat as success; reconcile can finish DB.
    return {
      kind: 'success',
      count: mintPks.length || 1,
      lastSig: sigs[sigs.length - 1] ?? null,
      mintAddresses: mintPks,
    }
  }
}
