import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/** Includes escrow parity fields (migration 045). */
const SELECT_ADMIN_FULL =
  'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address,nft_token_id,nft_metadata_uri,prize_standard,prize_deposit_tx,created_at,updated_at,created_by_wallet'

const SELECT_ADMIN_NO_ESCROW_EXTRA =
  'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address,nft_metadata_uri,created_at,updated_at,created_by_wallet'

const SELECT_ADMIN_MINIMAL =
  'id,title,description,access_gate,starts_at,ends_at,status,prize_deposited_at,nft_mint_address,created_at,updated_at,created_by_wallet'

async function selectAdminColumns() {
  const admin = getSupabaseAdmin()
  const full = await admin.from('community_giveaways').select(SELECT_ADMIN_FULL).order('created_at', { ascending: false })
  if (!full.error) return full

  const msg = typeof full.error.message === 'string' ? full.error.message : String(full.error)
  if (msg.includes('nft_token_id') || msg.includes('prize_standard') || msg.includes('prize_deposit_tx')) {
    const legacy = await admin
      .from('community_giveaways')
      .select(SELECT_ADMIN_NO_ESCROW_EXTRA)
      .order('created_at', { ascending: false })
    if (!legacy.error) return legacy
    const msg2 = typeof legacy.error.message === 'string' ? legacy.error.message : String(legacy.error)
    if (msg2.includes('nft_metadata_uri')) {
      return await admin.from('community_giveaways').select(SELECT_ADMIN_MINIMAL).order('created_at', { ascending: false })
    }
    return legacy
  }
  if (msg.includes('nft_metadata_uri')) {
    return await admin.from('community_giveaways').select(SELECT_ADMIN_MINIMAL).order('created_at', { ascending: false })
  }
  return full
}

/**
 * GET — list community giveaways (full admin, session required).
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const { data, error } = await selectAdminColumns()
    if (error) {
      const msg = typeof error.message === 'string' ? error.message : String(error)
      if (msg.toLowerCase().includes('community_giveaways') && (msg.includes('does not exist') || msg.includes('schema cache'))) {
        return NextResponse.json({
          giveaways: [],
          warning: 'community_giveaways table not found. Apply migration 044 in Supabase.',
        })
      }
      console.error('[admin/community-giveaways GET]', error)
      return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
    }
    return NextResponse.json({ giveaways: data ?? [] })
  } catch (e) {
    console.error('[admin/community-giveaways GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

function normalizeAccessGate(v: unknown): 'open' | 'holder_only' | null {
  if (v === 'open' || v === 'holder_only') return v
  return null
}

/**
 * POST — create community giveaway draft (full admin). Same prize flow as NFT raffles: select NFT,
 * then deposit to escrow + verify on the admin page — never trust a manual “deposited” flag.
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }
    const access_gate = normalizeAccessGate(body.access_gate) ?? 'open'
    const description =
      body.description === null || body.description === undefined
        ? null
        : String(body.description).trim() || null
    const starts_at = typeof body.starts_at === 'string' && body.starts_at.trim() ? body.starts_at.trim() : null
    if (!starts_at) {
      return NextResponse.json({ error: 'starts_at (ISO) is required' }, { status: 400 })
    }
    const ends_at =
      body.ends_at === null || body.ends_at === undefined || body.ends_at === ''
        ? null
        : typeof body.ends_at === 'string'
          ? body.ends_at.trim() || null
          : null
    const nft_mint_address =
      body.nft_mint_address === null || body.nft_mint_address === undefined || body.nft_mint_address === ''
        ? null
        : String(body.nft_mint_address).trim() || null
    if (!nft_mint_address) {
      return NextResponse.json({ error: 'nft_mint_address is required (select a prize NFT from your wallet)' }, { status: 400 })
    }
    const nft_metadata_uri =
      body.nft_metadata_uri === null || body.nft_metadata_uri === undefined || body.nft_metadata_uri === ''
        ? null
        : String(body.nft_metadata_uri).trim() || null
    const nft_token_id_raw =
      body.nft_token_id === null || body.nft_token_id === undefined || body.nft_token_id === ''
        ? null
        : String(body.nft_token_id).trim() || null
    const nft_token_id = nft_token_id_raw || nft_mint_address

    const now = new Date().toISOString()
    const admin = getSupabaseAdmin()
    const insertPayload: Record<string, unknown> = {
      title,
      description,
      access_gate,
      starts_at,
      ends_at,
      status: 'draft',
      prize_deposited_at: null,
      nft_mint_address,
      nft_token_id,
      created_by_wallet: session.wallet,
      updated_at: now,
    }
    if (nft_metadata_uri !== null) {
      insertPayload.nft_metadata_uri = nft_metadata_uri
    }

    let ins = await admin.from('community_giveaways').insert(insertPayload).select(SELECT_ADMIN_FULL).single()
    let data: unknown = ins.data
    let error = ins.error

    if (error && typeof error.message === 'string') {
      const msg = error.message
      if (msg.includes('nft_token_id') || msg.includes('prize_standard')) {
        delete insertPayload.nft_token_id
        const retry = await admin.from('community_giveaways').insert(insertPayload).select(SELECT_ADMIN_NO_ESCROW_EXTRA).single()
        data = retry.data
        error = retry.error
      } else if (msg.includes('nft_metadata_uri')) {
        delete insertPayload.nft_metadata_uri
        const retry2 = await admin.from('community_giveaways').insert(insertPayload).select(SELECT_ADMIN_MINIMAL).single()
        data = retry2.data
        error = retry2.error
      }
    }

    if (error) {
      console.error('[admin/community-giveaways POST]', error)
      return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
    }

    return NextResponse.json({ giveaway: data })
  } catch (e) {
    console.error('[admin/community-giveaways POST]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
