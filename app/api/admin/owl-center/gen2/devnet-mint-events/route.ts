import { NextRequest, NextResponse } from 'next/server'



import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'

import { getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'

import { getSupabaseAdmin } from '@/lib/supabase-admin'

import { getClientIp, rateLimit } from '@/lib/rate-limit'



export const dynamic = 'force-dynamic'



export async function GET(request: NextRequest) {

  const session = await requireGen2PresaleAdminSession(request)

  if (session instanceof NextResponse) return session



  const ip = getClientIp(request)

  if (!rateLimit(`admin-devnet-mint-ev:${ip}`, 60, 60_000).allowed) {

    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  }



  const launch = await getOwlCenterLaunchBySlugAdmin('gen2')

  if (!launch) {

    return NextResponse.json({ error: 'Launch not found' }, { status: 404 })

  }



  const limit = Math.min(80, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 40))



  const db = getSupabaseAdmin()

  const { data, error } = await db

    .from('owl_center_mint_events')

    .select('id,wallet_address,quantity,phase,tx_signature,candy_machine_id,created_at,network')

    .eq('launch_id', launch.id)

    .eq('network', 'devnet')

    .order('created_at', { ascending: false })

    .limit(limit)



  if (error) {

    console.error('devnet-mint-events', error)

    return NextResponse.json({ error: 'Database error' }, { status: 500 })

  }



  return NextResponse.json({ events: data ?? [] })

}


