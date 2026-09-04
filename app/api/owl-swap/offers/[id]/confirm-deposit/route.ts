import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { requireOwlSwapAccess } from '@/lib/owl-swap/require-owl-swap-access'
import {
  getOwlSwapOfferWithAssetsById,
  updateOwlSwapOffer,
} from '@/lib/db/owl-swap'
import {
  getOwlSwapEscrowPublicKey,
  getOwlSwapEscrowSolLamports,
  isMintHeldByOwlSwapEscrow,
} from '@/lib/owl-swap/escrow'
import { getSolanaConnection } from '@/lib/solana/connection'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

type Ctx = { params: Promise<{ id: string }> }

function requireConnectedMatchesSession(
  request: NextRequest,
  sessionWallet: string
): NextResponse | null {
  const connected = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
  if (!connected || connected !== sessionWallet) {
    return NextResponse.json(
      { error: 'Connected wallet does not match session. Sign in with this wallet.' },
      { status: 401 }
    )
  }
  return null
}

/** POST /api/owl-swap/offers/[id]/confirm-deposit — verify maker deposit → open. */
export async function POST(request: NextRequest, context: Ctx) {
  try {
    const session = await requireOwlSwapAccess(request)
    if (session instanceof NextResponse) return session

    const mismatch = requireConnectedMatchesSession(request, session.wallet)
    if (mismatch) return mismatch

    const { id } = await context.params
    if (!id?.trim()) {
      return NextResponse.json({ error: 'Offer id required' }, { status: 400 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`owl-swap-confirm:${ip}:${session.wallet}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const signature = typeof body?.signature === 'string' ? body.signature.trim() : ''
    if (!signature || signature.length < 32) {
      return NextResponse.json({ error: 'signature required' }, { status: 400 })
    }

    const escrow = getOwlSwapEscrowPublicKey()
    if (!escrow) {
      return NextResponse.json(
        { error: 'OwlSwap escrow is not configured.' },
        { status: 503 }
      )
    }

    const offer = await getOwlSwapOfferWithAssetsById(id.trim())
    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    }
    if (offer.maker_wallet !== session.wallet) {
      return NextResponse.json({ error: 'Only the maker can confirm deposit.' }, { status: 403 })
    }
    if (offer.status === 'open' && offer.maker_deposit_sig) {
      return NextResponse.json({
        ok: true,
        alreadyOpen: true,
        offer,
        sharePath: `/owl-swap/o/${offer.short_code}`,
      })
    }
    if (offer.status !== 'draft') {
      return NextResponse.json(
        { error: `Offer is ${offer.status}; expected draft.` },
        { status: 400 }
      )
    }

    const connection = getSolanaConnection()
    // Best-effort: wait for signature confirmation if still landing.
    try {
      await connection.confirmTransaction(signature, 'confirmed')
    } catch {
      // continue — balance checks are authoritative
    }

    const makerAssets = offer.assets.filter((a) => a.side === 'maker')
    for (const asset of makerAssets) {
      const held = await isMintHeldByOwlSwapEscrow(asset.mint, connection)
      if (!held) {
        return NextResponse.json(
          {
            error: `Escrow does not yet hold ${asset.name ?? asset.mint.slice(0, 8)}…. Wait for confirmation and retry.`,
          },
          { status: 400 }
        )
      }
    }

    if (offer.maker_sol_lamports > 0) {
      const bal = await getOwlSwapEscrowSolLamports(connection)
      // Soft check: escrow must have at least the sweetener (may hold more from other offers).
      if (bal < offer.maker_sol_lamports) {
        return NextResponse.json(
          {
            error:
              'Escrow SOL balance is below the offer sweetener. Confirm the deposit landed, then retry.',
          },
          { status: 400 }
        )
      }
    }

    const updated = await updateOwlSwapOffer(offer.id, {
      status: 'open',
      maker_deposit_sig: signature,
    })
    if (!updated.ok) {
      return NextResponse.json({ error: updated.error }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      offer: updated.row,
      sharePath: `/owl-swap/o/${updated.row.short_code}`,
    })
  } catch (e) {
    console.error('owl-swap confirm-deposit', e)
    return NextResponse.json({ error: 'Failed to confirm deposit' }, { status: 500 })
  }
}
