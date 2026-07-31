import { payoutCombinedCryptoFromGenOwlRevSharePool } from '@/lib/nesting/gen-owl-rev-share-pool'

export type GenOwlRevSharePayoutResult = {
  sol_signature: string | null
  usdc_signature: string | null
  payout_errors: string[]
}

/** Send SOL/USDC rev share from the dedicated rev-share pool (not funds escrow). */
export async function payoutGenOwlRevShareClaim(params: {
  wallet: string
  amount_sol: number
  amount_usdc: number
}): Promise<GenOwlRevSharePayoutResult> {
  return payoutCombinedCryptoFromGenOwlRevSharePool({
    recipientWallet: params.wallet,
    amount_sol: params.amount_sol,
    amount_usdc: params.amount_usdc,
  })
}
