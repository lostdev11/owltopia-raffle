import { ComputeBudgetProgram, Transaction } from '@solana/web3.js'

/**
 * Without SetComputeUnitLimit, Solana defaults the whole tx to 200k CU.
 * OwlSend batches of ≤5 can exceed that once we include create-ATA + revoke
 * (leftover Gen2 CM delegates) + transfer + fee — wallets (esp. Jupiter)
 * then fail simulation and never show an approve sheet.
 */
export const OWL_SEND_COMPUTE_UNIT_LIMIT = 400_000

/** Modest priority so mobile wallets land when the network is busy. */
export const OWL_SEND_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 50_000

/** Prepend compute-budget ixs (idempotent if caller already added them). */
export function prependOwlSendComputeBudget(tx: Transaction): Transaction {
  const already = tx.instructions.some((ix) =>
    ix.programId.equals(ComputeBudgetProgram.programId)
  )
  if (already) return tx

  tx.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: OWL_SEND_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({
      units: OWL_SEND_COMPUTE_UNIT_LIMIT,
    })
  )
  return tx
}

export function owlSendTxHasComputeBudget(tx: Transaction): boolean {
  return tx.instructions.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId))
}
