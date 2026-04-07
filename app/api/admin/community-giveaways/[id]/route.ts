import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getCommunityGiveawayById, updateCommunityGiveaway } from '@/lib/db/community-giveaways'
import type { CommunityGiveawayAccessGate, CommunityGiveawayStatus, PrizeStandard } from '@/lib/types'
import { safeErrorMessage } from '@/lib/safe-error'

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
 * PATCH /api/admin/community-giveaways/[id]
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

    const existing = await getCommunityGiveawayById(id)
    if (!existing) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const patch: Parameters<typeof updateCommunityGiveaway>[1] = {}

    if (existing.status === 'draft') {
      if (typeof body.title === 'string') patch.title = body.title.trim()
      if (typeof body.description === 'string') patch.description = body.description.trim() || null
      if (body.access_gate === 'open' || body.access_gate === 'holder_only') {
        patch.access_gate = body.access_gate as CommunityGiveawayAccessGate
      }
      if (typeof body.starts_at === 'string' && body.starts_at.trim()) {
        patch.starts_at = body.starts_at.trim()
      }
      if (body.ends_at === null) {
        patch.ends_at = null
      } else if (typeof body.ends_at === 'string') {
        patch.ends_at = body.ends_at.trim() || null
      }
      if (typeof body.nft_mint_address === 'string' && body.nft_mint_address.trim()) {
        patch.nft_mint_address = body.nft_mint_address.trim()
      }
      if (body.nft_token_id === null) {
        patch.nft_token_id = null
      } else if (typeof body.nft_token_id === 'string') {
        patch.nft_token_id = body.nft_token_id.trim() || null
      }
      if (body.prize_standard === null) {
        patch.prize_standard = null
      } else if (typeof body.prize_standard === 'string') {
        const ps = parsePrizeStandard(body.prize_standard)
        if (body.prize_standard !== '' && ps === null) {
          return NextResponse.json({ error: 'Invalid prize_standard' }, { status: 400 })
        }
        patch.prize_standard = ps
      }
      if (typeof body.deposit_tx_signature === 'string') {
        patch.deposit_tx_signature = body.deposit_tx_signature.trim() || null
      }
      if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null
    }

    if (existing.status === 'open') {
      if (body.ends_at === null) {
        patch.ends_at = null
      } else if (typeof body.ends_at === 'string') {
        patch.ends_at = body.ends_at.trim() || null
      }
      if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null
    }

    if (body.status === 'open') {
      if (existing.status !== 'draft') {
        return NextResponse.json({ error: 'Can only open from draft' }, { status: 400 })
      }
      if (!existing.prize_deposited_at) {
        return NextResponse.json(
          { error: 'Verify NFT deposit in escrow before opening' },
          { status: 400 }
        )
      }
      patch.status = 'open' as CommunityGiveawayStatus
    }

    if (body.status === 'cancelled') {
      if (existing.status !== 'open') {
        return NextResponse.json({ error: 'Can only cancel an open giveaway' }, { status: 400 })
      }
      if (existing.winner_wallet) {
        return NextResponse.json({ error: 'Cannot cancel after a winner is drawn' }, { status: 400 })
      }
      patch.status = 'cancelled' as CommunityGiveawayStatus
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const updated = await updateCommunityGiveaway(id, patch)
    if (!updated) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({ giveaway: updated })
  } catch (error) {
    console.error('[admin/community-giveaways PATCH]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
