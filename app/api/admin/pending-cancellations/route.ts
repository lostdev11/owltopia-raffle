import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET — any admin: raffles with a creator cancellation request still awaiting completion
 * (not the same as the truncated /api/raffles list, which is capped for cold-start resilience).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const { data, error } = await getSupabaseAdmin()
      .from('raffles')
      .select('id, slug, title, status, cancellation_requested_at, cancellation_fee_paid_at')
      .not('cancellation_requested_at', 'is', null)
      .neq('status', 'cancelled')
      .order('cancellation_requested_at', { ascending: false })

    if (error) {
      console.error('[GET /api/admin/pending-cancellations]', error)
      return NextResponse.json({ error: 'Could not load pending cancellations' }, { status: 502 })
    }

    const rows = (data ?? []) as Array<{
      id: string
      slug: string | null
      title: string | null
      status: string | null
      cancellation_requested_at: string | null
      cancellation_fee_paid_at: string | null
    }>

    const out = rows
      .filter((r) => r.id && (r.slug ?? '').trim())
      .map((r) => ({
        id: String(r.id),
        slug: String(r.slug ?? '').trim(),
        title: (r.title ?? 'Untitled raffle').trim() || 'Untitled raffle',
        status: r.status == null ? null : String(r.status),
        cancellation_requested_at:
          r.cancellation_requested_at == null ? null : String(r.cancellation_requested_at),
        cancellation_fee_paid_at:
          r.cancellation_fee_paid_at == null ? null : String(r.cancellation_fee_paid_at),
      }))

    return NextResponse.json(out, { status: 200 })
  } catch (err) {
    console.error('[GET /api/admin/pending-cancellations] unexpected:', err)
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 })
  }
}
