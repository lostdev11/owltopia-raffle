import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { requireOwlSwapAccess } from '@/lib/owl-swap/require-owl-swap-access'
import {
  OWL_SWAP_MAX_NFTS_PER_SIDE,
} from '@/lib/owl-swap/constants'
import { verifyOwlSwapMintForAllowlist } from '@/lib/owl-swap/allowlist'
import { getOwlSendHolderCounts } from '@/lib/owl-send/holder-counts'
import { quoteOwlSendHolderDiscount } from '@/lib/owl-send/holder-discount'
import { getOwlSwapFeeLamportsForCount } from '@/lib/owl-swap/fee'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'
import { getSolanaConnection } from '@/lib/solana/connection'
import {
  getOwlSwapEscrowPublicKey,
  isMintHeldByOwlSwapEscrow,
  sendOwlSwapSettleTransaction,
} from '@/lib/owl-swap/escrow'
import {
  deleteOwlSwapOfferAssetsForSide,
  getOwlSwapOfferWithAssetsById,
  insertOwlSwapLedger,
  insertOwlSwapOfferAssets,
  updateOwlSwapOffer,
} from '@/lib/db/owl-swap'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

type Ctx = { params: Promise<{ id: string }> }

function isPubkey(s: string): boolean {
  try {
    new PublicKey(s)
    return true
  } catch {
    return false
  }
}

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

async function txPaidFeeToTreasury(
  signature: string,
  treasury: string,
  minLamports: number
): Promise<boolean> {
  if (minLamports <= 0) return true
  const connection = getSolanaConnection()
  const fetchOptions = [
    { commitment: 'confirmed' as const, maxSupportedTransactionVersion: 0 },
    { commitment: 'confirmed' as const },
  ]
  let tx: Awaited<ReturnType<typeof connection.getTransaction>> | null = null
  for (const opts of fetchOptions) {
    tx = await connection.getTransaction(signature, opts as never).catch(() => null)
    if (tx?.meta) break
  }
  if (!tx?.meta || !tx.transaction) return false

  const message = tx.transaction.message
  const accountKeys =
    'getAccountKeys' in message && typeof message.getAccountKeys === 'function'
      ? message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58())
      : (
          (message as { accountKeys?: Array<PublicKey | string> }).accountKeys ?? []
        ).map((k) => (typeof k === 'string' ? k : k.toBase58()))

  const treasuryIdx = accountKeys.findIndex((k) => k === treasury)
  if (treasuryIdx < 0) return false
  const pre = tx.meta.preBalances[treasuryIdx] ?? 0
  const post = tx.meta.postBalances[treasuryIdx] ?? 0
  return post - pre >= minLamports
}

/** POST /api/owl-swap/offers/[id]/accept — verify taker deposit + settle. */
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
    const rl = rateLimit(`owl-swap-accept:${ip}:${session.wallet}`, 15, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const takerWallet =
      typeof body.takerWallet === 'string' ? body.takerWallet.trim() : session.wallet
    if (!isPubkey(takerWallet) || takerWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'takerWallet must match signed-in wallet.' },
        { status: 403 }
      )
    }

    const depositSignature =
      typeof body.depositSignature === 'string' ? body.depositSignature.trim() : ''
    if (!depositSignature || depositSignature.length < 32) {
      return NextResponse.json({ error: 'depositSignature required' }, { status: 400 })
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

    if (offer.status === 'completed' && offer.settle_sig) {
      return NextResponse.json({
        ok: true,
        alreadyCompleted: true,
        offer,
        settleSig: offer.settle_sig,
      })
    }

    if (offer.status !== 'open') {
      return NextResponse.json(
        { error: `Offer is ${offer.status}; expected open.` },
        { status: 400 }
      )
    }

    if (new Date(offer.expires_at).getTime() < Date.now()) {
      await updateOwlSwapOffer(offer.id, { status: 'expired' })
      return NextResponse.json({ error: 'Offer has expired.' }, { status: 410 })
    }

    if (offer.maker_wallet === takerWallet) {
      return NextResponse.json(
        { error: 'You cannot accept your own offer.' },
        { status: 400 }
      )
    }

    const mintsRaw = Array.isArray(body.takerMints) ? body.takerMints : []
    if (mintsRaw.length > OWL_SWAP_MAX_NFTS_PER_SIDE) {
      return NextResponse.json(
        { error: `Max ${OWL_SWAP_MAX_NFTS_PER_SIDE} NFTs per side.` },
        { status: 400 }
      )
    }

    const takerMints: Array<{
      mint: string
      name?: string | null
      imageUrl?: string | null
      collection?: string | null
    }> = []
    const seen = new Set<string>()
    for (const item of mintsRaw) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const mint = typeof row.mint === 'string' ? row.mint.trim() : ''
      if (!mint || !isPubkey(mint)) {
        return NextResponse.json({ error: 'Invalid mint in takerMints' }, { status: 400 })
      }
      if (seen.has(mint)) {
        return NextResponse.json({ error: 'Duplicate mint in takerMints' }, { status: 400 })
      }
      seen.add(mint)
      const collection =
        typeof row.collection === 'string' ? row.collection.trim() : null
      const allow = verifyOwlSwapMintForAllowlist({ mint, collection })
      if (!allow.verified) {
        return NextResponse.json(
          { error: allow.reason ?? 'Mint not allowlisted' },
          { status: 400 }
        )
      }
      takerMints.push({
        mint,
        name: typeof row.name === 'string' ? row.name : null,
        imageUrl:
          typeof row.imageUrl === 'string'
            ? row.imageUrl
            : typeof row.image_url === 'string'
              ? row.image_url
              : null,
        collection,
      })
    }

    const takerSolRaw = Number(body.takerSolLamports ?? 0)
    const takerSolLamports =
      Number.isFinite(takerSolRaw) && takerSolRaw > 0 ? Math.floor(takerSolRaw) : 0

    if (takerMints.length < 1 && takerSolLamports <= 0) {
      return NextResponse.json(
        { error: 'Offer at least one NFT or SOL sweetener.' },
        { status: 400 }
      )
    }

    const connection = getSolanaConnection()
    try {
      await connection.confirmTransaction(depositSignature, 'confirmed')
    } catch {
      // balance checks are authoritative
    }

    // Maker assets must still be in escrow
    const makerAssets = offer.assets.filter((a) => a.side === 'maker')
    for (const asset of makerAssets) {
      const held = await isMintHeldByOwlSwapEscrow(asset.mint, connection)
      if (!held) {
        return NextResponse.json(
          { error: `Maker asset ${asset.name ?? asset.mint.slice(0, 8)}… is no longer in escrow.` },
          { status: 400 }
        )
      }
    }

    for (const m of takerMints) {
      const held = await isMintHeldByOwlSwapEscrow(m.mint, connection)
      if (!held) {
        return NextResponse.json(
          {
            error: `Escrow does not yet hold your NFT ${m.name ?? m.mint.slice(0, 8)}…. Wait and retry.`,
          },
          { status: 400 }
        )
      }
    }

    const counts = await getOwlSendHolderCounts(takerWallet)
    const discount = quoteOwlSendHolderDiscount({
      gen1Count: counts.gen1Count,
      gen2Count: counts.gen2Count,
    })
    const feeLamports = getOwlSwapFeeLamportsForCount(1, discount.discountBps)
    const treasury = getPlatformFeeTreasuryWalletAddress()
    if (feeLamports > 0) {
      if (!treasury) {
        return NextResponse.json(
          { error: 'Platform fee treasury is not configured.' },
          { status: 503 }
        )
      }
      const feePaid = await txPaidFeeToTreasury(depositSignature, treasury, feeLamports)
      if (!feePaid) {
        return NextResponse.json(
          {
            error: `Deposit tx must include the Owl fee (${feeLamports} lamports) to the treasury.`,
          },
          { status: 400 }
        )
      }
    }

    await deleteOwlSwapOfferAssetsForSide(offer.id, 'taker')
    const assetInsert = await insertOwlSwapOfferAssets(
      takerMints.map((m) => ({
        offerId: offer.id,
        side: 'taker' as const,
        mint: m.mint,
        name: m.name,
        imageUrl: m.imageUrl,
        collection: m.collection,
        verified: true,
        assetKind: 'spl_nft' as const,
      }))
    )
    if (!assetInsert.ok) {
      return NextResponse.json({ error: assetInsert.error }, { status: 500 })
    }

    const settle = await sendOwlSwapSettleTransaction({
      maker: {
        mints: makerAssets.map((a) => a.mint),
        solLamports: offer.maker_sol_lamports,
        recipient: takerWallet,
      },
      taker: {
        mints: takerMints.map((m) => m.mint),
        solLamports: takerSolLamports,
        recipient: offer.maker_wallet,
      },
    })

    if (!settle.ok) {
      return NextResponse.json({ error: settle.error }, { status: 500 })
    }

    const updated = await updateOwlSwapOffer(offer.id, {
      status: 'completed',
      taker_wallet: takerWallet,
      taker_sol_lamports: takerSolLamports,
      owl_fee_lamports: feeLamports,
      fee_discount_bps: discount.discountBps,
      taker_deposit_sig: depositSignature,
      settle_sig: settle.signature,
      completed_at: new Date().toISOString(),
    })

    await insertOwlSwapLedger({
      offerId: offer.id,
      shortCode: offer.short_code,
      makerWallet: offer.maker_wallet,
      takerWallet,
      settleSig: settle.signature,
      owlFeeLamports: feeLamports,
      feeDiscountBps: discount.discountBps,
      makerMintCount: makerAssets.length,
      takerMintCount: takerMints.length,
    })

    return NextResponse.json({
      ok: true,
      offer: updated.ok ? updated.row : offer,
      settleSig: settle.signature,
      feeLamports,
      feeDiscountBps: discount.discountBps,
    })
  } catch (e) {
    console.error('owl-swap accept', e)
    return NextResponse.json({ error: 'Failed to accept offer' }, { status: 500 })
  }
}
