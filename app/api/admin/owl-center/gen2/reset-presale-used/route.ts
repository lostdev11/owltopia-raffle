import { NextRequest, NextResponse } from 'next/server'



import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'

import { getSupabaseAdmin } from '@/lib/supabase-admin'

import { getClientIp, rateLimit } from '@/lib/rate-limit'

import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'



export const dynamic = 'force-dynamic'



const CONFIRM_PHRASE = 'RESET_TEST_USED_MINTS'



export async function POST(request: NextRequest) {

  const session = await requireGen2PresaleAdminSession(request)

  if (session instanceof NextResponse) return session



  const ip = getClientIp(request)

  if (!rateLimit(`admin-reset-used:${ip}`, 20, 60_000).allowed) {

    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  }



  let body: { wallet?: string; confirm?: string }

  try {

    body = (await request.json()) as { wallet?: string; confirm?: string }

  } catch {

    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  }



  if (body.confirm !== CONFIRM_PHRASE) {

    return NextResponse.json({ error: `Confirmation required — send confirm: "${CONFIRM_PHRASE}"` }, { status: 400 })

  }



  const wallet = normalizeSolanaWalletAddress(typeof body.wallet === 'string' ? body.wallet : '')

  if (!wallet) return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })



  const db = getSupabaseAdmin()

  const { data, error } = await db.rpc('admin_reset_gen2_presale_used_mints', {

    p_wallet: wallet,

  })



  if (error) {

    console.error('admin_reset_gen2_presale_used_mints', error)

    return NextResponse.json({ error: error.message || 'Reset failed' }, { status: 500 })

  }



  const row = data as { ok?: boolean; error?: string } | null

  if (!row || row.ok !== true) {

    const err = typeof row?.error === 'string' ? row.error : 'reset_failed'

    const human: Record<string, string> = {

      balance_not_found: 'No presale balance row for this wallet',

    }

    return NextResponse.json({ error: human[err] ?? err }, { status: 400 })

  }



  return NextResponse.json({ ok: true, result: data })

}


