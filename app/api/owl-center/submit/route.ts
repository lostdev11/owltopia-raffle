import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import { forbidUnlessSelfOrAdmin } from '@/lib/api-wallet-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { owlCenterSubmitBody } from '@/lib/validations'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session

  const ip = getClientIp(request)
  if (!rateLimit(`owl-submit:${ip}`, 8, 3600_000).allowed) {
    return NextResponse.json({ error: 'Too many submissions — try later.' }, { status: 429 })
  }
  if (!rateLimit(`owl-submit:wallet:${session.wallet}`, 8, 3600_000).allowed) {
    return NextResponse.json({ error: 'Too many submissions — try later.' }, { status: 429 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = owlCenterSubmitBody.safeParse(raw)
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors
    const err = Object.entries(msg)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('; ')
    return NextResponse.json({ error: err || 'Invalid request' }, { status: 400 })
  }

  const body = parsed.data
  const authz = await forbidUnlessSelfOrAdmin(session, body.creator_wallet)
  if (authz) return authz

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_submissions')
    .insert({
      collection_name: body.collection_name,
      symbol: body.symbol,
      description: body.description ?? null,
      image_url: body.image_url ?? null,
      total_supply: body.total_supply,
      mint_price: body.mint_price,
      currency: body.currency,
      wallet_mint_limit: body.wallet_mint_limit,
      launch_date: body.launch_date ?? null,
      creator_wallet: body.creator_wallet,
      treasury_wallet: body.treasury_wallet ?? null,
      magic_eden_url: body.magic_eden_url ?? null,
      tensor_url: body.tensor_url ?? null,
      status: 'PENDING_REVIEW',
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('owl_center_submissions', error)
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: (data as { id: string }).id })
}
