import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { safeErrorMessage } from '@/lib/safe-error'
import {
  isCommunityGiveawayPubliclyVisible,
  notifyDiscordCommunityGiveawayStarted,
} from '@/lib/community-giveaways/discord-notify'

export const dynamic = 'force-dynamic'

const SELECT_ADMIN =
  'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address,nft_token_id,nft_metadata_uri,prize_standard,prize_deposit_tx,created_at,updated_at,created_by_wallet'

const SELECT_ADMIN_LEGACY =
  'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address,nft_metadata_uri,created_at,updated_at,created_by_wallet'

const SELECT_ADMIN_MINIMAL =
  'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address,created_at,updated_at,created_by_wallet'

function normalizeAccessGate(v: unknown): 'open' | 'holder_only' | undefined {
  if (v === 'open' || v === 'holder_only') return v
  return undefined
}

function normalizeStatus(v: unknown): 'draft' | 'open' | 'closed' | undefined {
  if (v === 'draft' || v === 'open' || v === 'closed') return v
  return undefined
}

/**
 * PATCH — update giveaway; Discord webhook when it first becomes publicly visible.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const _fullAdmin = await requireFullAdminSession(request)
  if (_fullAdmin instanceof NextResponse) return _fullAdmin
  try {
    const { id } = await context.params
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    let prevRes = await admin.from('community_giveaways').select(SELECT_ADMIN).eq('id', id.trim()).maybeSingle()
    if (prevRes.error) {
      const msg = typeof prevRes.error.message === 'string' ? prevRes.error.message : String(prevRes.error)
      if (msg.includes('nft_token_id') || msg.includes('prize_standard') || msg.includes('prize_deposit_tx')) {
        prevRes = await admin.from('community_giveaways').select(SELECT_ADMIN_LEGACY).eq('id', id.trim()).maybeSingle()
      } else if (msg.includes('nft_metadata_uri')) {
        prevRes = await admin.from('community_giveaways').select(SELECT_ADMIN_MINIMAL).eq('id', id.trim()).maybeSingle()
      }
    }
    if (prevRes.error) {
      console.error('[admin/community-giveaways PATCH] load', prevRes.error)
      return NextResponse.json({ error: safeErrorMessage(prevRes.error) }, { status: 500 })
    }
    const prev = prevRes.data as Record<string, unknown> | null

    if (!prev) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
    if (body.description !== undefined) {
      patch.description =
        body.description === null || body.description === ''
          ? null
          : String(body.description).trim() || null
    }
    const ag = normalizeAccessGate(body.access_gate)
    if (ag) patch.access_gate = ag
    if (typeof body.starts_at === 'string' && body.starts_at.trim()) patch.starts_at = body.starts_at.trim()
    if (body.ends_at !== undefined) {
      patch.ends_at =
        body.ends_at === null || body.ends_at === '' ? null : String(body.ends_at).trim() || null
    }
    const st = normalizeStatus(body.status)
    if (st) patch.status = st
    if (body.nft_mint_address !== undefined) {
      patch.nft_mint_address =
        body.nft_mint_address === null || body.nft_mint_address === ''
          ? null
          : String(body.nft_mint_address).trim() || null
    }
    if (body.nft_metadata_uri !== undefined) {
      patch.nft_metadata_uri =
        body.nft_metadata_uri === null || body.nft_metadata_uri === ''
          ? null
          : String(body.nft_metadata_uri).trim() || null
    }
    const merged = { ...prev, ...patch }
    const visibleAfter = isCommunityGiveawayPubliclyVisible({
      status: merged.status as string,
      prize_deposited_at: merged.prize_deposited_at as string | null,
    })
    const visibleBefore = isCommunityGiveawayPubliclyVisible({
      status: prev.status as string,
      prize_deposited_at: prev.prize_deposited_at as string | null,
    })

    if ((merged.status as string) === 'open' && !merged.prize_deposited_at) {
      return NextResponse.json(
        {
          error:
            'Open giveaways must have the prize verified in escrow first (transfer NFT to escrow, then Verify deposit on this page).',
        },
        { status: 400 }
      )
    }

    let res = await admin
      .from('community_giveaways')
      .update(patch)
      .eq('id', id.trim())
      .select(SELECT_ADMIN)
      .single()

    let data: Record<string, unknown> | null = res.data as Record<string, unknown> | null
    let error = res.error

    if (error && typeof error.message === 'string') {
      const em = error.message
      if (em.includes('nft_token_id') || em.includes('prize_standard') || em.includes('prize_deposit_tx')) {
        const retry = await admin
          .from('community_giveaways')
          .update(patch)
          .eq('id', id.trim())
          .select(SELECT_ADMIN_LEGACY)
          .single()
        data = retry.data as Record<string, unknown> | null
        error = retry.error
      } else if (em.includes('nft_metadata_uri')) {
        const patchNoMeta = { ...patch }
        delete patchNoMeta.nft_metadata_uri
        const retry = await admin
          .from('community_giveaways')
          .update(patchNoMeta)
          .eq('id', id.trim())
          .select(SELECT_ADMIN_LEGACY)
          .single()
        data = retry.data as Record<string, unknown> | null
        error = retry.error
      }
    }

    if (error) {
      console.error('[admin/community-giveaways PATCH]', error)
      return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
    }

    const row = data as {
      id: string
      title: string
      description: string | null
      access_gate: string
      starts_at: string
      ends_at: string | null
      status: string
      prize_deposited_at: string | null
      nft_mint_address: string | null
    }

    if (visibleAfter && !visibleBefore) {
      void notifyDiscordCommunityGiveawayStarted(row)
    }

    return NextResponse.json({ giveaway: data })
  } catch (e) {
    console.error('[admin/community-giveaways PATCH]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
