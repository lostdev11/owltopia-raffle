/**
 * Raffle creation fee: charged to non-admins when creating a raffle. Admins are exempt.
 *
 * Env (optional):
 * - RAFFLE_CREATION_FEE_LAMPORTS: amount in lamports (e.g. 100000000 = 0.1 SOL). Omit or 0 = no fee.
 * - RAFFLE_CREATION_FEE_RECIPIENT: SOL recipient. Defaults to RAFFLE_RECIPIENT_WALLET or NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET.
 */

function getCreationFeeLamports(): number {
  const raw = process.env.RAFFLE_CREATION_FEE_LAMPORTS
  if (raw === undefined || raw === null || raw === '') return 0
  const n = parseInt(String(raw), 10)
  return Number.isNaN(n) || n < 0 ? 0 : n
}

function getCreationFeeRecipient(): string | null {
  const recipient =
    process.env.RAFFLE_CREATION_FEE_RECIPIENT?.trim() ||
    process.env.RAFFLE_RECIPIENT_WALLET?.trim() ||
    process.env.NEXT_PUBLIC_RAFFLE_RECIPIENT_WALLET?.trim()
  return recipient || null
}

export function getCreationFeeConfig(): {
  creationFeeLamports: number
  creationFeeRecipient: string | null
  creationFeeRequired: boolean
} {
  const creationFeeLamports = getCreationFeeLamports()
  const creationFeeRecipient = getCreationFeeRecipient()
  const creationFeeRequired = creationFeeLamports > 0 && !!creationFeeRecipient
  return {
    creationFeeLamports,
    creationFeeRecipient,
    creationFeeRequired,
  }
}
