import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { normalizeDepositTxSignatureInput } from '@/lib/raffles/verify-prize-deposit-client'
import { verifyPrizeDepositInternal } from '@/lib/raffles/verify-prize-deposit-internal'
import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'

export const dynamic = 'force-dynamic'

function jsonFromVerifyResult(result: Awaited<ReturnType<typeof verifyPrizeDepositInternal>>) {
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.frozenEscrowDiagnostics ? { frozenEscrowDiagnostics: result.frozenEscrowDiagnostics } : {}),
      },
      { status: result.httpStatus }
    )
  }
  if (result.alreadyVerified) {
    return NextResponse.json({
      success: true,
      alreadyVerified: true,
      prizeDepositedAt: result.prizeDepositedAt,
    })
  }
  return NextResponse.json({
    success: true,
    prizeDepositedAt: result.prizeDepositedAt,
    ...(result.nftMintAddress ? { nftMintAddress: result.nftMintAddress } : {}),
    ...(result.prizeDepositTx !== undefined && result.prizeDepositTx !== null
      ? { prizeDepositTx: result.prizeDepositTx }
      : {}),
    ...(result.prizeStandard ? { prizeStandard: result.prizeStandard } : {}),
  })
}

/**
 * POST /api/raffles/[id]/verify-prize-deposit
 * Verifies that an NFT prize is in the platform escrow (discovered by what escrow holds)
 * and sets prize_deposited_at. Updates raffle nft_mint_address when escrow has exactly one NFT.
 * Optional body: { deposit_tx?: string } - when provided, parses the tx to identify which mint
 * was transferred to escrow (works even when escrow holds multiple NFTs).
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

    const body = await request.json().catch(() => ({}))
    const depositTxFromBody =
      typeof body.deposit_tx === 'string' ? normalizeDepositTxSignatureInput(body.deposit_tx) : null

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }
    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator = creatorWallet && session.wallet === creatorWallet
    const isAdmin = (await getAdminRole(session.wallet)) !== null
    if (!isCreator && !isAdmin) {
      return NextResponse.json(
        { error: 'Only the raffle creator or an admin can verify the prize deposit' },
        { status: 403 }
      )
    }

    const result = await verifyPrizeDepositInternal(id, depositTxFromBody)
    return jsonFromVerifyResult(result)
  } catch (error) {
    console.error('Verify prize deposit route error:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
