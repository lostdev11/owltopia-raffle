/**
 * Verify a SOL transfer used as post-start raffle cancellation fee (server-side).
 * Reuses the same checks as the optional raffle creation fee transfer.
 */
import { verifyCreationFeeTransaction } from '@/lib/verify-creation-fee'
import { getCancellationFeeSol } from '@/lib/config/raffles'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

export async function verifyCancellationFeeTransaction(
  transactionSignature: string,
  creatorWallet: string,
  treasuryWallet: string
): Promise<{ valid: boolean; error?: string; minLamports: number }> {
  const feeSol = getCancellationFeeSol()
  const minLamports = Math.max(0, Math.round(feeSol * LAMPORTS_PER_SOL))
  const v = await verifyCreationFeeTransaction(transactionSignature, creatorWallet, treasuryWallet, minLamports)
  if (!v.valid) {
    return { valid: false, error: v.error, minLamports }
  }
  return { valid: true, minLamports }
}
