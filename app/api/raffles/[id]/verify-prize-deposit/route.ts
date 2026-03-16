import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { getEscrowHeldNftMints, isMplCoreAssetInEscrow } from '@/lib/raffles/prize-escrow'
import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/verify-prize-deposit
 * Verifies that an NFT prize is in the platform escrow (discovered by what escrow holds)
 * and sets prize_deposited_at. Updates raffle nft_mint_address when escrow has exactly one NFT.
 * Caller must be the raffle creator or a full admin.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }
    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator = creatorWallet && session.wallet === creatorWallet
    const isFullAdmin = (await getAdminRole(session.wallet)) === 'full'
    if (!isCreator && !isFullAdmin) {
      return NextResponse.json(
        { error: 'Only the raffle creator or an admin can verify the prize deposit' },
        { status: 403 }
      )
    }
    if (raffle.prize_type !== 'nft') {
      return NextResponse.json(
        { error: 'This raffle does not have an NFT prize' },
        { status: 400 }
      )
    }
    if (raffle.prize_deposited_at) {
      return NextResponse.json({
        success: true,
        alreadyVerified: true,
        prizeDepositedAt: raffle.prize_deposited_at,
      })
    }

    // Mpl Core prizes: check asset owner instead of SPL token accounts.
    if ((raffle as any).prize_standard === 'mpl_core') {
      if (!raffle.nft_mint_address) {
        return NextResponse.json({ error: 'Missing NFT mint address' }, { status: 400 })
      }
      const inEscrow = await isMplCoreAssetInEscrow(raffle.nft_mint_address)
      if (!inEscrow) {
        return NextResponse.json(
          {
            error:
              'Core NFT not found in prize escrow. Complete the transfer, wait for confirmation, then try Verify again.',
          },
          { status: 400 }
        )
      }
      const now = new Date().toISOString()
      await updateRaffle(id, {
        prize_deposited_at: now,
        is_active: true,
      })
      return NextResponse.json({
        success: true,
        prizeDepositedAt: now,
        nftMintAddress: raffle.nft_mint_address,
      })
    }

    const held = await getEscrowHeldNftMints()
    if (held.length === 0) {
      return NextResponse.json(
        {
          error:
            'NFT not found in prize escrow. Complete the transfer using the button above, wait for confirmation, then try Verify again.',
        },
        { status: 400 }
      )
    }

    const preferredMint = (raffle.nft_mint_address || '').trim()
    let mintToSet: string
    if (held.length === 1) {
      mintToSet = held[0].mint
    } else {
      const match = held.find((h) => h.mint === preferredMint)
      if (match) {
        mintToSet = match.mint
      } else {
        return NextResponse.json(
          {
            error: `Escrow has multiple NFTs. This raffle expects mint ${preferredMint || '(not set)'}; none of the NFTs in escrow match. Set the raffle prize to the correct mint or leave only one NFT in escrow.`,
          },
          { status: 400 }
        )
      }
    }

    const now = new Date().toISOString()
    await updateRaffle(id, {
      prize_deposited_at: now,
      is_active: true,
      ...(mintToSet !== preferredMint ? { nft_mint_address: mintToSet } : {}),
    })
    return NextResponse.json({
      success: true,
      prizeDepositedAt: now,
      nftMintAddress: mintToSet,
    })
  } catch (error) {
    console.error('Verify prize deposit error:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
