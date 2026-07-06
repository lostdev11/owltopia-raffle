import { payoutCryptoFromFundsEscrow } from '@/lib/raffles/funds-escrow'

export type GenOwlRevSharePayoutResult = {
  sol_signature: string | null
  usdc_signature: string | null
  payout_errors: string[]
}

/** Send SOL/USDC rev share from funds escrow when configured. */
export async function payoutGenOwlRevShareClaim(params: {
  wallet: string
  amount_sol: number
  amount_usdc: number
}): Promise<GenOwlRevSharePayoutResult> {
  const errors: string[] = []
  let solSig: string | null = null
  let usdcSig: string | null = null

  if (params.amount_sol > 0) {
    const res = await payoutCryptoFromFundsEscrow({
      recipientWallet: params.wallet,
      amount: params.amount_sol,
      currency: 'SOL',
    })
    if (res.ok && res.signature) solSig = res.signature
    else errors.push(!res.ok ? res.error : 'SOL payout failed')
  }

  if (params.amount_usdc > 0) {
    const res = await payoutCryptoFromFundsEscrow({
      recipientWallet: params.wallet,
      amount: params.amount_usdc,
      currency: 'USDC',
    })
    if (res.ok && res.signature) usdcSig = res.signature
    else errors.push(!res.ok ? res.error : 'USDC payout failed')
  }

  return { sol_signature: solSig, usdc_signature: usdcSig, payout_errors: errors }
}
