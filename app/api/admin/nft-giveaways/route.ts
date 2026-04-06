import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { listAllNftGiveaways, createNftGiveaway } from '@/lib/db/nft-giveaways'
import { getDiscordGiveawayPartnerById } from '@/lib/db/discord-giveaway-partners'
import type { PrizeStandard } from '@/lib/types'
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

/**
 * GET /api/admin/nft-giveaways
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session
    const list = await listAllNftGiveaways()
    return NextResponse.json({
      giveaways: list,
      escrowAddress: getPrizeEscrowPublicKey(),
    })
  } catch (error) {
    console.error('[admin/nft-giveaways GET]', error)
    const msg = safeErrorMessage(error)
    if (msg.toLowerCase().includes('nft_giveaways') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Giveaways table missing. Run Supabase migration 051_nft_giveaways.sql.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * POST /api/admin/nft-giveaways
 * Body: { title?, nft_mint_address, nft_token_id?, prize_standard?, eligible_wallet, deposit_tx_signature?, notes? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const nftMint =
      typeof body.nft_mint_address === 'string' ? body.nft_mint_address.trim() : ''
    const eligible =
      typeof body.eligible_wallet === 'string' ? body.eligible_wallet.trim() : ''
    if (!nftMint || !eligible) {
      return NextResponse.json(
        { error: 'nft_mint_address and eligible_wallet are required' },
        { status: 400 }
      )
    }

    const prizeStandard = parsePrizeStandard(body.prize_standard)
    if (body.prize_standard != null && body.prize_standard !== '' && prizeStandard === null) {
      return NextResponse.json(
        { error: 'Invalid prize_standard (use spl, token2022, mpl_core, compressed, or omit)' },
        { status: 400 }
      )
    }

    let discord_partner_tenant_id: string | null = null
    if (
      typeof body.discord_partner_tenant_id === 'string' &&
      body.discord_partner_tenant_id.trim()
    ) {
      const tid = body.discord_partner_tenant_id.trim()
      const partner = await getDiscordGiveawayPartnerById(tid)
      if (!partner) {
        return NextResponse.json({ error: 'discord_partner_tenant_id not found' }, { status: 400 })
      }
      discord_partner_tenant_id = tid
    }

    const created = await createNftGiveaway({
      title: typeof body.title === 'string' ? body.title.trim() : null,
      nft_mint_address: nftMint,
      nft_token_id: typeof body.nft_token_id === 'string' ? body.nft_token_id.trim() : null,
      prize_standard: prizeStandard,
      eligible_wallet: eligible,
      deposit_tx_signature:
        typeof body.deposit_tx_signature === 'string' ? body.deposit_tx_signature.trim() : null,
      notes: typeof body.notes === 'string' ? body.notes.trim() : null,
      discord_partner_tenant_id,
      created_by_wallet: session.wallet,
    })

    return NextResponse.json({ giveaway: created })
  } catch (error) {
    console.error('[admin/nft-giveaways POST]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
