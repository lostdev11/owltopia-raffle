import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { RAFFLES_PENDING_CANCELLATION_QUEUE_STATUSES } from '@/lib/raffles/list-query-statuses'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

type RaffleCancellationRow = {
  id: string
  slug: string
  title: string
  status: string | null
  creator_wallet: string | null
  cancellation_requested_at: string | null
  cancellation_fee_paid_at: string | null
  cancelled_at: string | null
  cancellation_refund_policy: 'full_refund' | 'no_refund' | null
  cancellation_fee_amount: number | null
  cancellation_fee_currency: string | null
}

function mapRow(r: Record<string, unknown>): RaffleCancellationRow | null {
  const id = String(r.id ?? '').trim()
  const slug = String(r.slug ?? '').trim()
  if (!id || !slug) return null

  return {
    id,
    slug,
    title: (String(r.title ?? 'Untitled raffle').trim() || 'Untitled raffle'),
    status: r.status == null ? null : String(r.status),
    creator_wallet: r.creator_wallet == null ? null : String(r.creator_wallet),
    cancellation_requested_at:
      r.cancellation_requested_at == null ? null : String(r.cancellation_requested_at),
    cancellation_fee_paid_at:
      r.cancellation_fee_paid_at == null ? null : String(r.cancellation_fee_paid_at),
    cancelled_at: r.cancelled_at == null ? null : String(r.cancelled_at),
    cancellation_refund_policy:
      r.cancellation_refund_policy === 'full_refund' || r.cancellation_refund_policy === 'no_refund'
        ? r.cancellation_refund_policy
        : null,
    cancellation_fee_amount:
      r.cancellation_fee_amount == null ? null : Number(r.cancellation_fee_amount),
    cancellation_fee_currency:
      r.cancellation_fee_currency == null ? null : String(r.cancellation_fee_currency),
  }
}

const SELECT_COLUMNS =
  'id, slug, title, status, creator_wallet, cancellation_requested_at, cancellation_fee_paid_at, cancelled_at, cancellation_refund_policy, cancellation_fee_amount, cancellation_fee_currency'

/**
 * GET — admin cancellation queue: pending requests, accepted history, and platform cancellation rate.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const db = getSupabaseAdmin()

    const creatorCancellationFilter =
      'cancellation_requested_at.not.is.null,cancellation_fee_paid_at.not.is.null'

    const [pendingRes, acceptedRes, acceptedCountRes, hostedCountRes, completedCountRes] =
      await Promise.all([
        db
          .from('raffles')
          .select(SELECT_COLUMNS)
          .or(creatorCancellationFilter)
          .in('status', [...RAFFLES_PENDING_CANCELLATION_QUEUE_STATUSES])
          .order('cancellation_requested_at', { ascending: false }),
        db
          .from('raffles')
          .select(SELECT_COLUMNS)
          .not('cancelled_at', 'is', null)
          .or(creatorCancellationFilter)
          .order('cancelled_at', { ascending: false })
          .limit(200),
        db
          .from('raffles')
          .select('id', { count: 'exact', head: true })
          .not('cancelled_at', 'is', null)
          .or(creatorCancellationFilter),
        db.from('raffles').select('id', { count: 'exact', head: true }).neq('status', 'draft'),
        db.from('raffles').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      ])

    if (pendingRes.error) {
      console.error('[GET /api/admin/cancellations] pending:', pendingRes.error)
      return NextResponse.json({ error: 'Could not load pending cancellations' }, { status: 502 })
    }
    if (acceptedRes.error) {
      console.error('[GET /api/admin/cancellations] accepted:', acceptedRes.error)
      return NextResponse.json({ error: 'Could not load accepted cancellations' }, { status: 502 })
    }

    const pending = (pendingRes.data ?? [])
      .map((row) => mapRow(row as Record<string, unknown>))
      .filter((row): row is RaffleCancellationRow => row != null)

    const accepted = (acceptedRes.data ?? [])
      .map((row) => mapRow(row as Record<string, unknown>))
      .filter((row): row is RaffleCancellationRow => row != null)

    const hostedRaffles = hostedCountRes.count ?? 0
    const completedRaffles = completedCountRes.count ?? 0
    const acceptedCount = acceptedCountRes.count ?? accepted.length
    const pendingCount = pending.length
    const cancellationRatePercent =
      hostedRaffles > 0 ? Math.round((acceptedCount / hostedRaffles) * 1000) / 10 : 0

    return NextResponse.json({
      pending,
      accepted,
      stats: {
        pendingCount,
        acceptedCount,
        hostedRaffles,
        completedRaffles,
        cancellationRatePercent,
      },
    })
  } catch (err) {
    console.error('[GET /api/admin/cancellations] unexpected:', err)
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 })
  }
}
