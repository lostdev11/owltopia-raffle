import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getGenOwlNestRoster, type GenOwlNestRosterPayload } from '@/lib/db/gen-owl-nest-roster'
import { resolveGenOwlGroupKey, genOwlStakingGroupLabel } from '@/lib/nesting/gen-owl-staking-groups'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function csvCell(value: string | number | null): string {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(payload: GenOwlNestRosterPayload): string {
  const lines = [
    'position_id,wallet_address,pool_slug,lock_period_days,asset_identifier,status,staked_at,unlock_at,referral_code',
  ]
  for (const p of payload.positions) {
    lines.push(
      [
        p.position_id,
        p.wallet_address,
        p.pool_slug,
        p.lock_period_days,
        p.asset_identifier,
        p.status,
        p.staked_at,
        p.unlock_at,
        p.referral_code,
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return lines.join('\n')
}

/**
 * GET /api/admin/staking/nest-roster?group=gen1-owl|gen2-owl[&format=csv]
 * Who nested — open nests per wallet split by 90d vs 180d lock tier,
 * with each nester's referral code for referral-program cross-checks.
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const sp = request.nextUrl.searchParams
    const group = resolveGenOwlGroupKey(sp.get('group')) ?? 'gen1-owl'
    const payload = await getGenOwlNestRoster(group)

    if (sp.get('format') === 'csv') {
      const label = genOwlStakingGroupLabel(group).toLowerCase().replace(/\s+/g, '-')
      return new NextResponse(toCsv(payload), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${label}-nest-roster.csv"`,
        },
      })
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[admin/staking/nest-roster]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
