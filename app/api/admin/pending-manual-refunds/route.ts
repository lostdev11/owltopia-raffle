import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { listRaffleUnrefundedConfirmedEntryCounts } from '@/lib/db/entries'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { safeErrorMessage, safeErrorDetails } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

function statusNeedsRefundRecording(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase()
  return (
    s === 'failed_refund_available' ||
    s === 'pending_min_not_met' ||
    s === 'cancelled'
  )
}

async function fetchRafflesMeta(
  ids: string[]
): Promise<Array<{ id: string; slug: string; title: string; status: string | null; currency: string | null }>> {
  if (ids.length === 0) return []
  const out: Array<{ id: string; slug: string; title: string; status: string | null; currency: string | null }> = []
  const chunkSize = 80
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize)
    const { data, error } = await getSupabaseAdmin()
      .from('raffles')
      .select('id, slug, title, status, currency')
      .in('id', slice)

    if (error) {
      console.error('[pending-manual-refunds] raffles fetch:', error)
      continue
    }
    for (const row of data ?? []) {
      const r = row as {
        id: string
        slug: string
        title: string
        status: string | null
        currency: string | null
      }
      if (r?.id) out.push(r)
    }
  }
  return out
}

/**
 * GET — full admin: raffles with at least one confirmed, unrefunded ticket (needs manual payout tx recording or buyer claim).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const rows = await listRaffleUnrefundedConfirmedEntryCounts()
    if (rows.length === 0) {
      return NextResponse.json({ raffles: [] })
    }

    const metaById = new Map(
      (await fetchRafflesMeta(rows.map((r) => r.raffleId))).map((m) => [m.id, m])
    )

    const raffles = rows
      .map((r) => {
        const m = metaById.get(r.raffleId)
        if (!m) return null
        return {
          raffleId: r.raffleId,
          slug: m.slug,
          title: m.title,
          status: m.status,
          currency: m.currency,
          unrefundedEntryCount: r.unrefundedEntryCount,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .filter((x) => statusNeedsRefundRecording(x.status))

    return NextResponse.json({ raffles })
  } catch (error) {
    console.error('[pending-manual-refunds]', error)
    return NextResponse.json(
      {
        error: safeErrorMessage(error),
        ...(safeErrorDetails(error) && { details: safeErrorDetails(error) }),
      },
      { status: 500 }
    )
  }
}
