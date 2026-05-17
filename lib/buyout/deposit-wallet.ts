import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'

/**
 * Wallet that receives NFT buyout bid deposits (SOL/USDC).
 * Same funds escrow as ticket proceeds — signing via FUNDS_ESCROW_SECRET_KEY.
 */
export function getBuyoutDepositWalletAddress(): string | null {
  return getFundsEscrowPublicKey()
}
