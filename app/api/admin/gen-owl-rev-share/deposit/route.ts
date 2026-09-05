import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getGenOwlRevSharePoolBalances,
  getGenOwlRevSharePoolPublicKey,
} from '@/lib/nesting/gen-owl-rev-share-pool'
import { confirmGenOwlRevSharePoolDeposit } from '@/lib/nesting/gen-owl-rev-share-deposit-service'
import { StakingUserError } from '@/lib/nesting/errors'
import { getRevShareSchedule } from '@/lib/db/rev-share-schedule'
import { getGenOwlRevSharePeriod } from '@/lib/db/gen-owl-rev-share-periods'
import {
  formatPeriodMonthUtc,
  claimsOpenForPeriod,
  periodMonthFromScheduleDate,
} from '@/lib/nesting/gen-owl-rev-share-month'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

function periodSummary(
  period: Awaited<ReturnType<typeof getGenOwlRevSharePeriod>>
): {
  gen1_total_sol: number | null
  gen1_total_usdc: number | null
  gen2_total_sol: number | null
  gen2_total_usdc: number | null
  finalized_at: string | null
} | null {
  if (!period) return null
  return {
    gen1_total_sol: period.gen1_total_sol,
    gen1_total_usdc: period.gen1_total_usdc,
    gen2_total_sol: period.gen2_total_sol,
    gen2_total_usdc: period.gen2_total_usdc,
    finalized_at: period.finalized_at,
  }
}

/**
 * GET /api/admin/gen-owl-rev-share/deposit
 * Full admin — pool address for connected-wallet deposits + current period claimable totals.
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  const address = getGenOwlRevSharePoolPublicKey()
  if (!address) {
    return NextResponse.json(
      {
        error:
          'Rev share pool is not configured. Set GEN_OWL_REV_SHARE_POOL_SECRET_KEY on the server.',
      },
      { status: 503 }
    )
  }
  const schedule = await getRevShareSchedule()
  const currentMonth = formatPeriodMonthUtc(new Date())
  const gen1PeriodMonth =
    periodMonthFromScheduleDate(schedule?.gen1_next_date ?? schedule?.next_date) ?? currentMonth
  const gen2PeriodMonth =
    periodMonthFromScheduleDate(schedule?.gen2_next_date ?? schedule?.next_date) ?? currentMonth
  const periodMonth = currentMonth
  const [period, gen1Period, gen2Period, poolBalances] = await Promise.all([
    getGenOwlRevSharePeriod(periodMonth),
    getGenOwlRevSharePeriod(gen1PeriodMonth),
    getGenOwlRevSharePeriod(gen2PeriodMonth),
    getGenOwlRevSharePoolBalances(),
  ])
  return NextResponse.json({
    address,
    period_month: periodMonth,
    gen1_period_month: gen1PeriodMonth,
    gen2_period_month: gen2PeriodMonth,
    claims_open: claimsOpenForPeriod(periodMonth),
    period: periodSummary(period),
    gen1_period: periodSummary(gen1Period),
    gen2_period: periodSummary(gen2Period),
    pool_onchain: {
      sol: poolBalances.sol,
      usdc: poolBalances.usdc,
      sol_lamports: poolBalances.sol_lamports,
    },
  })
}

/**
 * POST /api/admin/gen-owl-rev-share/deposit
 * Full admin — verify deposit tx(s) and credit period totals.
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    const result = await confirmGenOwlRevSharePoolDeposit({
      depositorWallet: session.wallet,
      period_month: typeof body.period_month === 'string' ? body.period_month : null,
      gen1_total_sol: body.gen1_total_sol != null ? Number(body.gen1_total_sol) : null,
      gen1_total_usdc: body.gen1_total_usdc != null ? Number(body.gen1_total_usdc) : null,
      gen2_total_sol: body.gen2_total_sol != null ? Number(body.gen2_total_sol) : null,
      gen2_total_usdc: body.gen2_total_usdc != null ? Number(body.gen2_total_usdc) : null,
      sol_signature: typeof body.sol_signature === 'string' ? body.sol_signature : null,
      usdc_signature: typeof body.usdc_signature === 'string' ? body.usdc_signature : null,
      allow_older_tx: body.allow_older_tx === true,
      gen1_next_date:
        body.gen1_next_date !== undefined
          ? body.gen1_next_date == null
            ? null
            : String(body.gen1_next_date)
          : undefined,
      gen2_next_date:
        body.gen2_next_date !== undefined
          ? body.gen2_next_date == null
            ? null
            : String(body.gen2_next_date)
          : undefined,
    })

    const schedule = await getRevShareSchedule()
    return NextResponse.json({
      ...result,
      schedule,
    })
  } catch (e) {
    if (e instanceof StakingUserError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('[admin/gen-owl-rev-share/deposit]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
