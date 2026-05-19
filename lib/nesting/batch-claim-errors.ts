export type BatchClaimLedgerSyncPayload = {
  total_claimed: number
  claims: Array<{
    position_id: string
    claimed: number
    claimed_rewards_total: number
  }>
}

/** OWL was sent on-chain but nest ledger rows could not be persisted (retry or support recovery). */
export class BatchClaimLedgerSyncError extends Error {
  readonly txSignature: string
  readonly payload: BatchClaimLedgerSyncPayload

  constructor(txSignature: string, cause: unknown, payload: BatchClaimLedgerSyncPayload) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Batch claim ledger sync failed after on-chain transfer: ${detail}`)
    this.name = 'BatchClaimLedgerSyncError'
    this.txSignature = txSignature
    this.payload = payload
  }
}

export function isBatchClaimLedgerSyncError(e: unknown): e is BatchClaimLedgerSyncError {
  return e instanceof BatchClaimLedgerSyncError
}
