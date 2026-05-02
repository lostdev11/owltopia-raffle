import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') ?? 50) || 50))

    const db = getSupabaseAdmin()
    const { data, error } = await db
      .from('gen2_presale_purchases')
      .select('id, wallet, quantity, tx_signature, created_at, total_lamports, status')
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ purchases: data ?? [] })
  } catch (error) {
    console.error('admin gen2-presale purchases:', error)
    return NextResponse.json({ error: 'Failed to load purchases' }, { status: 500 })
  }
}
