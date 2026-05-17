/** OWL was sent on-chain but nest ledger rows could not be persisted (retry or support recovery). */
export class BatchClaimLedgerSyncError extends Error {
  readonly txSignature: string

  constructor(txSignature: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Batch claim ledger sync failed after on-chain transfer: ${detail}`)
    this.name = 'BatchClaimLedgerSyncError'
    this.txSignature = txSignature
  }
}

export function isBatchClaimLedgerSyncError(e: unknown): e is BatchClaimLedgerSyncError {
  return e instanceof BatchClaimLedgerSyncError
}
