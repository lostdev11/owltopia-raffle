import { NextRequest, NextResponse } from 'next/server'
import { PublicKey } from '@solana/web3.js'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { requireOwlSwapAccess } from '@/lib/owl-swap/require-owl-swap-access'
import {
  OWL_SWAP_MAX_NFTS_PER_SIDE,
  OWL_SWAP_MAX_OPEN_OFFERS_PER_WALLET,
  OWL_SWAP_OFFER_TTL_HOURS,
} from '@/lib/owl-swap/constants'
import { getOwlSwapOfferTtlHours } from '@/lib/owl-swap/fee'
import { generateOwlSwapShortCode } from '@/lib/owl-swap/short-code'
import { verifyOwlSwapMintForAllowlist } from '@/lib/owl-swap/allowlist'
import {
  countOpenOwlSwapOffersForMaker,
  getOwlSwapOfferByShortCode,
  insertOwlSwapOffer,
  insertOwlSwapOfferAssets,
} from '@/lib/db/owl-swap'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

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

/** POST /api/owl-swap/offers — create draft offer + maker assets. */
export async function POST(request: NextRequest) {
  try {
    const session = await requireOwlSwapAccess(request)
    if (session instanceof NextResponse) return session

    const mismatch = requireConnectedMatchesSession(request, session.wallet)
    if (mismatch) return mismatch

    const ip = getClientIp(request)
    const rl = rateLimit(`owl-swap-offers-create:${ip}:${session.wallet}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const makerWallet =
      typeof body.makerWallet === 'string' ? body.makerWallet.trim() : session.wallet
    if (!isPubkey(makerWallet)) {
      return NextResponse.json({ error: 'Invalid makerWallet' }, { status: 400 })
    }
    if (makerWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'makerWallet must match signed-in wallet.' },
        { status: 403 }
      )
    }

    const openCount = await countOpenOwlSwapOffersForMaker(makerWallet)
    if (openCount >= OWL_SWAP_MAX_OPEN_OFFERS_PER_WALLET) {
      return NextResponse.json(
        {
          error: `Max ${OWL_SWAP_MAX_OPEN_OFFERS_PER_WALLET} open/draft offers per wallet.`,
        },
        { status: 400 }
      )
    }

    const mintsRaw = Array.isArray(body.makerMints) ? body.makerMints : []
    if (mintsRaw.length < 1) {
      return NextResponse.json({ error: 'Select at least one NFT.' }, { status: 400 })
    }
    if (mintsRaw.length > OWL_SWAP_MAX_NFTS_PER_SIDE) {
      return NextResponse.json(
        { error: `Max ${OWL_SWAP_MAX_NFTS_PER_SIDE} NFTs per side.` },
        { status: 400 }
      )
    }

    const makerMints: Array<{
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
        return NextResponse.json({ error: 'Invalid mint in makerMints' }, { status: 400 })
      }
      if (seen.has(mint)) {
        return NextResponse.json({ error: 'Duplicate mint in makerMints' }, { status: 400 })
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
      makerMints.push({
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
    if (makerMints.length < 1) {
      return NextResponse.json({ error: 'Select at least one NFT.' }, { status: 400 })
    }

    const makerSolRaw = Number(body.makerSolLamports ?? 0)
    const makerSolLamports =
      Number.isFinite(makerSolRaw) && makerSolRaw > 0 ? Math.floor(makerSolRaw) : 0

    const ttlHours = getOwlSwapOfferTtlHours() || OWL_SWAP_OFFER_TTL_HOURS
    let expiresAt: Date
    if (typeof body.expires === 'string' && body.expires.trim()) {
      const parsed = new Date(body.expires)
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid expires' }, { status: 400 })
      }
      expiresAt = parsed
    } else {
      expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000)
    }

    let shortCode = generateOwlSwapShortCode()
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = await getOwlSwapOfferByShortCode(shortCode)
      if (!existing) break
      shortCode = generateOwlSwapShortCode()
    }

    const created = await insertOwlSwapOffer({
      shortCode,
      makerWallet,
      makerSolLamports,
      expiresAt: expiresAt.toISOString(),
      status: 'draft',
    })
    if (!created.ok) {
      return NextResponse.json({ error: created.error }, { status: 500 })
    }

    const assets = await insertOwlSwapOfferAssets(
      makerMints.map((m) => ({
        offerId: created.row.id,
        side: 'maker' as const,
        mint: m.mint,
        name: m.name,
        imageUrl: m.imageUrl,
        collection: m.collection,
        verified: true,
        assetKind: 'spl_nft' as const,
      }))
    )
    if (!assets.ok) {
      return NextResponse.json({ error: assets.error }, { status: 500 })
    }

    return NextResponse.json({
      offer: created.row,
      assets: assets.rows,
      sharePath: `/owl-swap/o/${created.row.short_code}`,
    })
  } catch (e) {
    console.error('owl-swap offers POST', e)
    return NextResponse.json({ error: 'Failed to create offer' }, { status: 500 })
  }
}
