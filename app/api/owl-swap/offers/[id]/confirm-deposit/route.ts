import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { requireOwlSwapAccess } from '@/lib/owl-swap/require-owl-swap-access'
import {
  findActiveOwlSwapMintsInUse,
  getOwlSwapOfferWithAssetsById,
  isOwlSwapDepositSignatureUsed,
  updateOwlSwapOffer,
} from '@/lib/db/owl-swap'
import { getOwlSwapEscrowPublicKey } from '@/lib/owl-swap/escrow'
import {
  isOwlSwapSimulateEnabled,
  isOwlSwapSimulateSignature,
} from '@/lib/owl-swap/simulate'
import { verifyOwlSwapDepositTransaction } from '@/lib/owl-swap/verify-deposit-tx'
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
    if (!signature || signature.length < 8) {
      return NextResponse.json({ error: 'signature required' }, { status: 400 })
    }

    const simulateRequested = isOwlSwapSimulateSignature(signature)
    const simulateAllowed = isOwlSwapSimulateEnabled()
    const escrow = getOwlSwapEscrowPublicKey()

    if (simulateRequested && !simulateAllowed) {
      return NextResponse.json(
        { error: 'Simulation mode is not enabled (set escrow or OWL_SWAP_SIMULATE, admin-only).' },
        { status: 403 }
      )
    }

    if (!simulateRequested && !escrow) {
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
        simulate: isOwlSwapSimulateSignature(offer.maker_deposit_sig),
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

    if (await isOwlSwapDepositSignatureUsed(signature, offer.id)) {
      return NextResponse.json(
        { error: 'This deposit signature was already used on another offer.' },
        { status: 409 }
      )
    }

    const makerAssets = offer.assets.filter((a) => a.side === 'maker')
    const mints = makerAssets.map((a) => a.mint)
    const inUse = await findActiveOwlSwapMintsInUse(mints, offer.id)
    if (inUse.length > 0) {
      return NextResponse.json(
        {
          error: `Mint already listed on another active offer: ${inUse[0].slice(0, 8)}…`,
        },
        { status: 409 }
      )
    }

    if (!simulateRequested && escrow) {
      const connection = getSolanaConnection()
      try {
        await connection.confirmTransaction(signature, 'confirmed')
      } catch {
        // parsed verification is authoritative
      }

      const verified = await verifyOwlSwapDepositTransaction({
        signature,
        expectedPayer: session.wallet,
        escrowAddress: escrow,
        mints,
        expectedSolLamports: offer.maker_sol_lamports,
      })
      if (!verified.ok) {
        return NextResponse.json({ error: verified.error }, { status: 400 })
      }
    }

    const updated = await updateOwlSwapOffer(offer.id, {
      status: 'open',
      maker_deposit_sig: signature,
    })
    if (!updated.ok) {
      if (/unique|duplicate/i.test(updated.error)) {
        return NextResponse.json(
          { error: 'This deposit signature was already used on another offer.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: updated.error }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      simulate: simulateRequested,
      offer: updated.row,
      sharePath: `/owl-swap/o/${updated.row.short_code}`,
    })
  } catch (e) {
    console.error('owl-swap confirm-deposit', e)
    return NextResponse.json({ error: 'Failed to confirm deposit' }, { status: 500 })
  }
}
