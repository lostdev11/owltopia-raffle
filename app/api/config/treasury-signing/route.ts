import { NextResponse } from 'next/server'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { getTreasurySigningPublicKey } from '@/lib/solana/treasury-signing'

export const dynamic = 'force-dynamic'

/**
 * GET /api/config/treasury-signing
 * When RAFFLE_RECIPIENT_SECRET_KEY matches RAFFLE_RECIPIENT_WALLET — buyout refunds and winner payouts can be signed server-side.
 */
export async function GET() {
  const expectedWallet = getRaffleTreasuryWalletAddress()
  const signingAddress = getTreasurySigningPublicKey()

  if (!expectedWallet) {
    return NextResponse.json(
      { error: 'RAFFLE_RECIPIENT_WALLET is not configured' },
      { status: 503 },
    )
  }

  if (!signingAddress) {
    return NextResponse.json(
      {
        error:
          'Treasury signing is not configured. Set RAFFLE_RECIPIENT_SECRET_KEY to the private key for RAFFLE_RECIPIENT_WALLET.',
        expectedWallet,
        buyoutRefundsEnabled: false,
      },
      { status: 503 },
    )
  }

  return NextResponse.json({
    address: signingAddress,
    expectedWallet,
    buyoutRefundsEnabled: true,
  })
}
