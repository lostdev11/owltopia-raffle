import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { createCommunityGiveaway, listAllCommunityGiveaways } from '@/lib/db/community-giveaways'
import type { CommunityGiveawayAccessGate, PrizeStandard } from '@/lib/types'
import { safeErrorMessage } from '@/lib/safe-error'
import { getPrizeEscrowPublicKey } from '@/lib/raffles/prize-escrow'

export const dynamic = 'force-dynamic'

const PRIZE_STANDARDS: PrizeStandard[] = ['spl', 'token2022', 'mpl_core', 'compressed']

function parsePrizeStandard(raw: unknown): PrizeStandard | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw !== 'string' || !PRIZE_STANDARDS.includes(raw as PrizeStandard)) {
    return null
  }
  return raw as PrizeStandard
}

function parseAccessGate(raw: unknown): CommunityGiveawayAccessGate | null {
  if (raw === 'open' || raw === 'holder_only') return raw
  return null
}

/**
 * GET /api/admin/community-giveaways
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session
    const list = await listAllCommunityGiveaways()
    return NextResponse.json({
      giveaways: list,
      escrowAddress: getPrizeEscrowPublicKey(),
    })
  } catch (error) {
    console.error('[admin/community-giveaways GET]', error)
    const msg = safeErrorMessage(error)
    if (msg.toLowerCase().includes('community_giveaways') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Community giveaways table missing. Run Supabase migration 055_community_giveaways.sql.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * POST /api/admin/community-giveaways
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const nftMint = typeof body.nft_mint_address === 'string' ? body.nft_mint_address.trim() : ''
    const startsAt = typeof body.starts_at === 'string' ? body.starts_at.trim() : ''

    const accessGate = parseAccessGate(body.access_gate)
    if (!title || !nftMint || !startsAt) {
      return NextResponse.json(
        { error: 'title, nft_mint_address, starts_at (ISO), and access_gate (open | holder_only) are required' },
        { status: 400 }
      )
    }
    if (!accessGate) {
      return NextResponse.json({ error: 'access_gate must be open or holder_only' }, { status: 400 })
    }

    const prizeStandard = parsePrizeStandard(body.prize_standard)
    if (body.prize_standard != null && body.prize_standard !== '' && prizeStandard === null) {
      return NextResponse.json(
        { error: 'Invalid prize_standard (spl, token2022, mpl_core, compressed, or omit)' },
        { status: 400 }
      )
    }

    let endsAt: string | null = null
    if (typeof body.ends_at === 'string' && body.ends_at.trim()) {
      endsAt = body.ends_at.trim()
    }

    const created = await createCommunityGiveaway({
      title,
      description: typeof body.description === 'string' ? body.description.trim() : null,
      access_gate: accessGate,
      starts_at: startsAt,
      ends_at: endsAt,
      nft_mint_address: nftMint,
      nft_token_id: typeof body.nft_token_id === 'string' ? body.nft_token_id.trim() : null,
      prize_standard: prizeStandard,
      deposit_tx_signature:
        typeof body.deposit_tx_signature === 'string' ? body.deposit_tx_signature.trim() : null,
      notes: typeof body.notes === 'string' ? body.notes.trim() : null,
      created_by_wallet: session.wallet,
    })

    return NextResponse.json({ giveaway: created })
  } catch (error) {
    console.error('[admin/community-giveaways POST]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
