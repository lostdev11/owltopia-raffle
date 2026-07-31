import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { forceRefinalizeGenOwlRevSharePeriod } from '@/lib/nesting/gen-owl-rev-share-finalize'
import { formatPeriodMonthUtc } from '@/lib/nesting/gen-owl-rev-share-month'
import { StakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/gen-owl-rev-share/refinalize
 * Full admin — clear and recompute period per-nest amounts (repair under-counted finalize).
 * Body: { period_month?: "YYYY-MM" } — defaults to current UTC month.
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    const periodMonth =
      typeof body.period_month === 'string' && body.period_month.trim()
        ? body.period_month.trim()
        : formatPeriodMonthUtc(new Date())

    const period = await forceRefinalizeGenOwlRevSharePeriod(periodMonth)
    if (!period?.finalized_at) {
      return NextResponse.json(
        {
          error:
            'Could not refinalize. Claims must be in the open window for that month, and the period needs deposit totals. If counts look wrong, check server logs for under-count refusal.',
          period_month: periodMonth,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      period_month: period.period_month,
      gen1_eligible_count: period.gen1_eligible_count,
      gen1_standard_eligible_count: period.gen1_standard_eligible_count,
      gen1_one_of_one_eligible_count: period.gen1_one_of_one_eligible_count,
      gen1_standard_per_nest_sol: period.gen1_standard_per_nest_sol,
      gen1_one_of_one_per_nest_sol: period.gen1_one_of_one_per_nest_sol,
      gen2_eligible_count: period.gen2_eligible_count,
      gen2_per_nest_sol: period.gen2_per_nest_sol,
      finalized_at: period.finalized_at,
    })
  } catch (e) {
    if (e instanceof StakingUserError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('[admin/gen-owl-rev-share/refinalize]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
