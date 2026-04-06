import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getNftGiveawayById, updateNftGiveaway } from '@/lib/db/nft-giveaways'
import { getDiscordGiveawayPartnerById } from '@/lib/db/discord-giveaway-partners'
import type { PrizeStandard } from '@/lib/types'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const PRIZE_STANDARDS: PrizeStandard[] = ['spl', 'token2022', 'mpl_core', 'compressed']

function parsePrizeStandard(raw: unknown): PrizeStandard | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  if (typeof raw !== 'string' || !PRIZE_STANDARDS.includes(raw as PrizeStandard)) {
    return undefined
  }
  return raw as PrizeStandard
}

/**
 * PATCH /api/admin/nft-giveaways/[id]
 * Update metadata before deposit verify or claim. Cannot change mint/eligible after claim.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const existing = await getNftGiveawayById(id)
    if (!existing) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }
    if (existing.claimed_at) {
      return NextResponse.json(
        { error: 'Giveaway already claimed; only notes/title can be changed via support.' },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const patch: Parameters<typeof updateNftGiveaway>[1] = {}

    if (typeof body.title === 'string') patch.title = body.title.trim() || null
    if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null
    if (typeof body.eligible_wallet === 'string') patch.eligible_wallet = body.eligible_wallet.trim()
    if (typeof body.nft_mint_address === 'string') patch.nft_mint_address = body.nft_mint_address.trim()
    if (typeof body.nft_token_id === 'string') patch.nft_token_id = body.nft_token_id.trim() || null
    if (body.nft_token_id === null) patch.nft_token_id = null

    const ps = parsePrizeStandard(body.prize_standard)
    if (body.prize_standard !== undefined && ps === undefined && body.prize_standard !== null && body.prize_standard !== '') {
      return NextResponse.json({ error: 'Invalid prize_standard' }, { status: 400 })
    }
    if (ps !== undefined) patch.prize_standard = ps

    if (typeof body.deposit_tx_signature === 'string') {
      patch.deposit_tx_signature = body.deposit_tx_signature.trim() || null
    }

    if (body.discord_partner_tenant_id !== undefined) {
      if (body.discord_partner_tenant_id === null || body.discord_partner_tenant_id === '') {
        patch.discord_partner_tenant_id = null
      } else if (typeof body.discord_partner_tenant_id === 'string') {
        const tid = body.discord_partner_tenant_id.trim()
        const partner = await getDiscordGiveawayPartnerById(tid)
        if (!partner) {
          return NextResponse.json({ error: 'discord_partner_tenant_id not found' }, { status: 400 })
        }
        patch.discord_partner_tenant_id = tid
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const updated = await updateNftGiveaway(id, patch)
    if (!updated) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }
    return NextResponse.json({ giveaway: updated })
  } catch (error) {
    console.error('[admin/nft-giveaways PATCH]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
