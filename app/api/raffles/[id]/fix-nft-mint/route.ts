import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getEscrowTokenAccountForMint, isMplCoreAssetInEscrow } from '@/lib/raffles/prize-escrow'
import { PublicKey } from '@solana/web3.js'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/fix-nft-mint
 * Admin-only: correct a raffle's nft_mint_address when the wrong link was stored
 * but the correct NFT was deposited to escrow.
 *
 * Body: { nft_mint_address: string }
 * - Validates the mint is a valid Solana address
 * - Verifies the NFT is in escrow (SPL or Mpl Core)
 * - Updates nft_mint_address and nft_token_id
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const mintStr = typeof body.nft_mint_address === 'string' ? body.nft_mint_address.trim() : ''
    if (!mintStr) {
      return NextResponse.json(
        { error: 'nft_mint_address is required (correct Solscan token/mint address)' },
        { status: 400 }
      )
    }

    // Validate it's a valid Solana public key
    let mint: PublicKey
    try {
      mint = new PublicKey(mintStr)
    } catch {
      return NextResponse.json(
        { error: 'Invalid Solana address for nft_mint_address' },
        { status: 400 }
      )
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }
    if (raffle.prize_type !== 'nft') {
      return NextResponse.json(
        { error: 'This raffle does not have an NFT prize' },
        { status: 400 }
      )
    }

    // Verify the NFT is in escrow before updating
    const ata = await getEscrowTokenAccountForMint(mint)
    let inEscrow = !!ata
    if (!inEscrow) {
      try {
        inEscrow = await isMplCoreAssetInEscrow(mintStr)
      } catch {
        inEscrow = false
      }
    }
    if (!inEscrow) {
      return NextResponse.json(
        {
          error:
            'NFT not found in prize escrow. Only update to a mint that is confirmed in escrow. ' +
            'Check the correct mint on Solscan and ensure the NFT was transferred to escrow.',
        },
        { status: 400 }
      )
    }

    await updateRaffle(id, {
      nft_mint_address: mintStr,
      nft_token_id: mintStr,
    })

    return NextResponse.json({
      success: true,
      message: 'Raffle NFT mint address updated',
      nft_mint_address: mintStr,
      solscan_url: `https://solscan.io/token/${mintStr}`,
    })
  } catch (error) {
    console.error('Fix NFT mint error:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
