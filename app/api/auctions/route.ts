import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { canAccessPartnerAuctions, canCreatePartnerAuction } from '@/lib/auctions/access'
import {
  AUCTION_DURATION_PRESETS_MS,
  AUCTION_MAX_LIVE_PER_CREATOR,
  type AuctionDurationPreset,
} from '@/lib/auctions/constants'
import { toPublicAuction } from '@/lib/auctions/public'
import { generateUniqueAuctionSlug, slugifyAuctionTitle } from '@/lib/auctions/slug'
import {
  countLiveAuctionsForCreator,
  insertAuction,
  listAuctionsForPartners,
} from '@/lib/db/auctions'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import { getPrizeEscrowPublicKey } from '@/lib/raffles/prize-escrow'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import type { AuctionBidCurrency, AuctionPrizeType } from '@/lib/auctions/types'

export const dynamic = 'force-dynamic'

/** GET /api/auctions — partner/admin only list. */
export async function GET(request: NextRequest) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  if (!(await canAccessPartnerAuctions(session.wallet))) {
    return NextResponse.json({ error: 'Partner or admin access required' }, { status: 403 })
  }

  const status = request.nextUrl.searchParams.get('status')
  const auctions = await listAuctionsForPartners({
    status: status
      ? (status.split(',') as Array<
          'draft' | 'live' | 'ended' | 'successful_pending_claims' | 'failed_reserve' | 'cancelled' | 'completed'
        >)
      : ['live', 'successful_pending_claims', 'failed_reserve', 'draft', 'completed'],
    limit: 50,
  })

  return NextResponse.json({
    auctions: auctions.map(toPublicAuction),
  })
}

/** POST /api/auctions — create draft auction (partner/admin). */
export async function POST(request: NextRequest) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  if (!(await canCreatePartnerAuction(session.wallet))) {
    return NextResponse.json({ error: 'Partner or admin access required' }, { status: 403 })
  }

  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title.length < 3) {
    return NextResponse.json({ error: 'Title is required (min 3 chars)' }, { status: 400 })
  }

  const prizeType = String(body.prize_type || '').toLowerCase() as AuctionPrizeType
  if (!['nft', 'sol', 'usdc'].includes(prizeType)) {
    return NextResponse.json({ error: 'prize_type must be nft, sol, or usdc' }, { status: 400 })
  }

  let bidCurrency = String(body.bid_currency || 'SOL').toUpperCase() as AuctionBidCurrency
  if (prizeType === 'sol') bidCurrency = 'SOL'
  if (prizeType === 'usdc') bidCurrency = 'USDC'
  if (!['SOL', 'USDC'].includes(bidCurrency)) {
    return NextResponse.json({ error: 'bid_currency must be SOL or USDC' }, { status: 400 })
  }

  const startPrice = Number(body.start_price)
  if (!Number.isFinite(startPrice) || startPrice <= 0) {
    return NextResponse.json({ error: 'start_price must be a positive number' }, { status: 400 })
  }

  const reserveRaw = body.reserve_price
  const reservePrice =
    reserveRaw == null || reserveRaw === ''
      ? null
      : Number(reserveRaw)
  if (reservePrice != null && (!Number.isFinite(reservePrice) || reservePrice < startPrice)) {
    return NextResponse.json(
      { error: 'reserve_price must be >= start_price when set' },
      { status: 400 }
    )
  }

  const durationKey = String(body.duration || '24h') as AuctionDurationPreset
  const durationMs = AUCTION_DURATION_PRESETS_MS[durationKey]
  if (!durationMs) {
    return NextResponse.json(
      { error: 'duration must be one of 1h, 6h, 24h, 3d, 7d' },
      { status: 400 }
    )
  }

  const liveCount = await countLiveAuctionsForCreator(wallet)
  // Also count drafts toward soft cap? Only live for now.
  if (liveCount >= AUCTION_MAX_LIVE_PER_CREATOR) {
    return NextResponse.json(
      {
        error: `You already have ${AUCTION_MAX_LIVE_PER_CREATOR} live auctions. End or settle one before creating another.`,
      },
      { status: 429 }
    )
  }

  let nftMint: string | null = null
  let nftTokenId: string | null = null
  let prizeAmount: number | null = null
  if (prizeType === 'nft') {
    nftMint = typeof body.nft_mint_address === 'string' ? body.nft_mint_address.trim() : ''
    if (!nftMint) {
      return NextResponse.json({ error: 'nft_mint_address is required for NFT auctions' }, { status: 400 })
    }
    nftTokenId =
      typeof body.nft_token_id === 'string' && body.nft_token_id.trim()
        ? body.nft_token_id.trim()
        : null
  } else {
    prizeAmount = Number(body.prize_amount)
    if (!Number.isFinite(prizeAmount) || prizeAmount <= 0) {
      return NextResponse.json({ error: 'prize_amount is required for SOL/USDC auctions' }, { status: 400 })
    }
  }

  const feeTier = await getCreatorFeeTier(wallet, { skipCache: true })
  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + durationMs)
  const slug = await generateUniqueAuctionSlug(slugifyAuctionTitle(title))

  const auction = await insertAuction({
    slug,
    title,
    description: typeof body.description === 'string' ? body.description : null,
    image_url: typeof body.image_url === 'string' ? body.image_url : null,
    creator_wallet: wallet,
    prize_type: prizeType,
    nft_mint_address: nftMint,
    nft_token_id: nftTokenId,
    prize_standard: typeof body.prize_standard === 'string' ? body.prize_standard : null,
    prize_amount: prizeAmount,
    bid_currency: bidCurrency,
    start_price: startPrice,
    reserve_price: reservePrice,
    reserve_hidden: body.reserve_hidden !== false,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    fee_bps_applied: feeTier.feeBps,
    fee_tier_reason: feeTier.reason,
    prize_escrow_address_snapshot: getPrizeEscrowPublicKey(),
    funds_escrow_address_snapshot: getFundsEscrowPublicKey(),
  })

  if (!auction) {
    return NextResponse.json({ error: 'Failed to create auction' }, { status: 500 })
  }

  return NextResponse.json({
    auction: toPublicAuction(auction),
    prize_escrow: getPrizeEscrowPublicKey(),
    funds_escrow: getFundsEscrowPublicKey(),
  })
}
