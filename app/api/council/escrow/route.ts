import { NextResponse } from 'next/server'
import { getCouncilOwlEscrowPublicKeyBase58, isCouncilOwlEscrowVotingEnabled } from '@/lib/council/council-owl-escrow-keypair'
import { getCouncilEscrowMinDepositUi } from '@/lib/council/council-owl-escrow-config'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

export const dynamic = 'force-dynamic'

/**
 * GET /api/council/escrow
 * Public: whether council OWL escrow voting is configured + deposit target (no secrets).
 */
export async function GET() {
  try {
    if (!isOwlEnabled()) {
      return NextResponse.json({ enabled: false, reason: 'owl_not_configured' })
    }

    if (!isCouncilOwlEscrowVotingEnabled()) {
      return NextResponse.json({ enabled: false, reason: 'escrow_not_configured' })
    }

    const owl = getTokenInfo('OWL')
    if (!owl.mintAddress) {
      return NextResponse.json({ enabled: false, reason: 'owl_mint_missing' })
    }

    const escrowAddress = getCouncilOwlEscrowPublicKeyBase58()
    if (!escrowAddress) {
      return NextResponse.json({ enabled: false, reason: 'escrow_not_configured' })
    }

    return NextResponse.json({
      enabled: true,
      escrowAddress,
      owlMint: owl.mintAddress,
      decimals: owl.decimals,
      minDepositUi: getCouncilEscrowMinDepositUi(),
    })
  } catch (error) {
    console.error('[api/council/escrow] GET:', error)
    return NextResponse.json({ error: 'Failed to load escrow config' }, { status: 500 })
  }
}
