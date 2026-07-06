import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getLeaderboardWithMeta,
  parseLeaderboardPeriodFromSearchParams,
  type LeaderboardData,
  type LeaderboardEntry,
  type LeaderboardPeriodMeta,
} from '@/lib/db/leaderboard'
import { getDisplayNamesByWallets } from '@/lib/db/wallet-profiles'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

type SnapshotRow = {
  rank: number
  wallet: string
  displayName: string | null
  value: number
}

type SnapshotBoard = {
  key: keyof LeaderboardData
  title: string
  rows: SnapshotRow[]
}

const BOARD_TITLES: Record<keyof LeaderboardData, string> = {
  ticketsPurchased: 'Most tickets purchased',
  rafflesEntered: 'Most raffles entered',
  rafflesCreated: 'Most raffles created',
  rafflesWon: 'Most raffles won',
  ticketsSold: 'Most tickets sold (creators)',
}

function collectWallets(data: LeaderboardData): string[] {
  const wallets = new Set<string>()
  for (const board of Object.values(data)) {
    for (const row of board) wallets.add(row.wallet)
  }
  return [...wallets]
}

function enrichBoard(
  key: keyof LeaderboardData,
  entries: LeaderboardEntry[],
  names: Record<string, string>
): SnapshotBoard {
  return {
    key,
    title: BOARD_TITLES[key],
    rows: entries.map((row) => ({
      rank: row.rank,
      wallet: row.wallet,
      displayName: names[row.wallet] ?? null,
      value: row.value,
    })),
  }
}

function toCsv(
  period: LeaderboardPeriodMeta,
  boards: SnapshotBoard[],
  snapshotAt: string,
  boardKey?: keyof LeaderboardData
): string {
  const selected = boardKey ? boards.filter((b) => b.key === boardKey) : boards
  const lines: string[] = [
    `# Leaderboard snapshot`,
    `# Period: ${period.label}`,
    `# Rules: ${period.leaderboardRules ?? 'legacy'}`,
    `# Range: ${period.rangeStart ?? 'all'} to ${period.rangeEndExclusive ?? 'now'}`,
    `# Snapshot at: ${snapshotAt}`,
    '',
  ]

  for (const board of selected) {
    lines.push(`## ${board.title}`)
    lines.push('rank,wallet,display_name,value')
    for (const row of board.rows) {
      const name = row.displayName ? `"${row.displayName.replace(/"/g, '""')}"` : ''
      lines.push(`${row.rank},${row.wallet},${name},${row.value}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * GET /api/admin/leaderboard-snapshot
 * Admin-only frozen export for prize verification (e.g. July ticket challenge).
 *
 * Query params match GET /api/leaderboard (period, year, month).
 * - format=csv — download CSV (optional board=ticketsPurchased for one board)
 * - Default JSON includes display names and snapshot timestamp.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const sp = request.nextUrl.searchParams
    const period = parseLeaderboardPeriodFromSearchParams(sp)
    const { leaderboard, period: meta } = await getLeaderboardWithMeta(period)
    const names = await getDisplayNamesByWallets(collectWallets(leaderboard))
    const snapshotAt = new Date().toISOString()

    const boards: SnapshotBoard[] = (
      Object.keys(BOARD_TITLES) as Array<keyof LeaderboardData>
    ).map((key) => enrichBoard(key, leaderboard[key], names))

    const boardParam = sp.get('board') as keyof LeaderboardData | null
    if (sp.get('format') === 'csv') {
      const filename = `leaderboard-${meta.kind}${meta.year ? `-${meta.year}` : ''}${meta.month ? `-${String(meta.month).padStart(2, '0')}` : ''}.csv`
      return new NextResponse(toCsv(meta, boards, snapshotAt, boardParam ?? undefined), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    return NextResponse.json({
      snapshotAt,
      period: meta,
      boards,
    })
  } catch (error) {
    console.error('[admin/leaderboard-snapshot]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
