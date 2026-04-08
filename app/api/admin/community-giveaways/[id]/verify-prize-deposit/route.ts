import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { safeErrorMessage } from '@/lib/safe-error'
import { verifyNftPrizeDepositCore } from '@/lib/raffles/verify-nft-prize-deposit-core'
import {
  isCommunityGiveawayPubliclyVisible,
  notifyDiscordCommunityGiveawayStarted,
} from '@/lib/community-giveaways/discord-notify'

export const dynamic = 'force-dynamic'

const SELECT_ROW =
  'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address,nft_token_id,nft_metadata_uri,prize_standard,prize_deposit_tx'

const SELECT_ROW_LEGACY =
  'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address,nft_metadata_uri'

/**
 * POST /api/admin/community-giveaways/[id]/verify-prize-deposit
 * Same on-chain checks as raffle NFT prizes; persists to community_giveaways (no is_active).
 * Full admin + session. Optional body: { deposit_tx?: string }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await requireFullAdminSession(request)
  if (gate instanceof NextResponse) return gate

  try {
    const { id } = await context.params
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const depositTx = typeof body.deposit_tx === 'string' ? body.deposit_tx.trim() : null

    const admin = getSupabaseAdmin()
    let load = await admin.from('community_giveaways').select(SELECT_ROW).eq('id', id.trim()).maybeSingle()
    if (load.error) {
      const m = typeof load.error.message === 'string' ? load.error.message : String(load.error)
      if (m.includes('nft_token_id') || m.includes('prize_standard') || m.includes('prize_deposit_tx')) {
        load = await admin.from('community_giveaways').select(SELECT_ROW_LEGACY).eq('id', id.trim()).maybeSingle()
      }
    }

    if (load.error) {
      console.error('[community-giveaways verify-prize-deposit] load', load.error)
      return NextResponse.json({ error: safeErrorMessage(load.error) }, { status: 500 })
    }
    const row = load.data as Record<string, unknown> | null
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const visibleBefore = isCommunityGiveawayPubliclyVisible({
      status: row.status as string,
      prize_deposited_at: row.prize_deposited_at as string | null,
    })

    const outcome = await verifyNftPrizeDepositCore(
      {
        nft_mint_address: (row.nft_mint_address as string) || null,
        nft_token_id: (row.nft_token_id as string) || null,
        prize_standard: (row.prize_standard as string) || null,
      },
      depositTx,
      (row.prize_deposited_at as string) || null
    )

    if (outcome.kind === 'already_verified') {
      return NextResponse.json({
        success: true,
        alreadyVerified: true,
        prizeDepositedAt: outcome.prizeDepositedAt,
      })
    }
    if (outcome.kind === 'error') {
      return NextResponse.json({ error: outcome.message }, { status: outcome.status })
    }

    const patch: Record<string, unknown> = { ...outcome.dbPatch, updated_at: new Date().toISOString() }
    delete patch.is_active

    let { data: updated, error: upErr } = await admin
      .from('community_giveaways')
      .update(patch)
      .eq('id', id.trim())
      .select(SELECT_ROW)
      .single()

    if (upErr && typeof upErr.message === 'string') {
      const msg = upErr.message
      if (msg.includes('nft_token_id') || msg.includes('prize_standard') || msg.includes('prize_deposit_tx')) {
        const patchMinimal = { ...patch }
        delete patchMinimal.nft_token_id
        delete patchMinimal.prize_standard
        delete patchMinimal.prize_deposit_tx
        let retry = await admin
          .from('community_giveaways')
          .update(patchMinimal)
          .eq('id', id.trim())
          .select(SELECT_ROW)
          .single()
        if (retry.error && String(retry.error.message || '').includes('nft_token_id')) {
          retry = await admin
            .from('community_giveaways')
            .update(patchMinimal)
            .eq('id', id.trim())
            .select(SELECT_ROW_LEGACY)
            .single()
        }
        updated = retry.data
        upErr = retry.error
      }
    }

    if (upErr) {
      console.error('[community-giveaways verify-prize-deposit] update', upErr)
      return NextResponse.json({ error: safeErrorMessage(upErr) }, { status: 500 })
    }

    const u = updated as Record<string, unknown>
    const visibleAfter = isCommunityGiveawayPubliclyVisible({
      status: u.status as string,
      prize_deposited_at: u.prize_deposited_at as string | null,
    })
    if (visibleAfter && !visibleBefore) {
      void notifyDiscordCommunityGiveawayStarted({
        id: String(u.id),
        title: String(u.title ?? ''),
        description: (u.description as string) || null,
        access_gate: String(u.access_gate ?? 'open'),
        starts_at: String(u.starts_at ?? ''),
        ends_at: (u.ends_at as string) || null,
        nft_mint_address: (u.nft_mint_address as string) || null,
      })
    }

    return NextResponse.json({
      success: true,
      prizeDepositedAt: outcome.prizeDepositedAt,
      nftMintAddress: outcome.nftMintAddress,
      ...(outcome.prizeDepositTx ? { prizeDepositTx: outcome.prizeDepositTx } : {}),
      ...(outcome.prizeStandard ? { prizeStandard: outcome.prizeStandard } : {}),
    })
  } catch (e) {
    console.error('[community-giveaways verify-prize-deposit]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
