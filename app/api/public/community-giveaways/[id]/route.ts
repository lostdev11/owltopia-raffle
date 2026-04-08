import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getSupabaseForServerRead } from '@/lib/supabase-admin'
import { fetchNftPreviewImageUrl } from '@/lib/solana/fetch-nft-preview-image'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/community-giveaways/[id]
 * Minimal public metadata when the giveaway is open and prize is in escrow.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const db = getSupabaseForServerRead(supabase)
    let data: Record<string, unknown> | null = null
    let error: { message?: string } | null = null

    const full = await db
      .from('community_giveaways')
      .select(
        'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address,nft_metadata_uri'
      )
      .eq('id', id.trim())
      .maybeSingle()

    if (full.error) {
      const msg = typeof full.error.message === 'string' ? full.error.message : String(full.error)
      if (msg.includes('nft_metadata_uri')) {
        const minimal = await db
          .from('community_giveaways')
          .select(
            'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address'
          )
          .eq('id', id.trim())
          .maybeSingle()
        data = minimal.data as Record<string, unknown> | null
        error = minimal.error
      } else {
        data = full.data as Record<string, unknown> | null
        error = full.error
      }
    } else {
      data = full.data as Record<string, unknown> | null
      error = full.error
    }

    if (error) {
      const msg = typeof error.message === 'string' ? error.message : String(error)
      if (
        msg.toLowerCase().includes('community_giveaways') ||
        msg.includes('does not exist') ||
        msg.includes('schema cache')
      ) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      console.error('[public/community-giveaways/id]', error)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (!data || data.status !== 'open' || !data.prize_deposited_at) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const row = data as {
      id: string
      title: string
      description: string | null
      access_gate: string
      starts_at: string
      ends_at: string | null
      nft_mint_address?: string | null
      nft_metadata_uri?: string | null
    }

    const prize_image_url = await fetchNftPreviewImageUrl({
      nft_mint_address: row.nft_mint_address ?? null,
      nft_metadata_uri: row.nft_metadata_uri ?? null,
    })

    return NextResponse.json({
      giveaway: {
        id: row.id,
        title: row.title,
        description: row.description,
        access_gate: row.access_gate,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        nft_mint_address: row.nft_mint_address?.trim() || null,
        prize_image_url,
      },
    })
  } catch (e) {
    console.error('[public/community-giveaways/id]', e)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
