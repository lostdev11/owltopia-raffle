import {
  recordMintSessionConfirms,
  resolveMintSessionOutcome,
  type MintConfirmBatchPayload,
} from '@/lib/owl-center/mint-session'
import { MINT_CONFIRM_BACKGROUND_MAX_MS, raceMintSessionBudget, createMintSessionDeadline } from '@/lib/owl-center/mint-time-budget'
import type { MintGen2Result } from '@/lib/solana/gen2-mint'

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
  onRecordWarning?: (message: string) => void
}

/** Show mint success as soon as the chain tx is done; record to DB in the background (≤12s). */
export function finalizeMintSessionOptimistic(args: OptimisticMintFinalizeArgs): void {
  const { minted, requestedQuantity, confirmBatch, onSuccess, onRecordWarning } = args

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

  const confirmDeadline = createMintSessionDeadline(MINT_CONFIRM_BACKGROUND_MAX_MS)
  void (async () => {
    try {
      await raceMintSessionBudget(
        confirmDeadline,
        recordMintSessionConfirms(sigs, mintPks, confirmBatch),
        'Saving mint timed out'
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'confirm_failed'
      onRecordWarning?.(
        `${msg} — your NFT${outcome.mintedCount === 1 ? '' : 's'} minted on-chain; refresh if the counter looks wrong.`
      )
    }
  })()
}
