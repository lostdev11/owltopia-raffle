'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Download, RefreshCw } from 'lucide-react'

type SnapshotRow = {
  rank: number
  wallet: string
  displayName: string | null
  value: number
}

type SnapshotBoard = {
  key: string
  title: string
  rows: SnapshotRow[]
}

type SnapshotPayload = {
  snapshotAt: string
  period: {
    kind: string
    year?: number
    month?: number
    label: string
    leaderboardRules?: string
  }
  boards: SnapshotBoard[]
}

function utcNowYm(): { year: number; month: number } {
  const d = new Date()
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

export function AdminLeaderboardSnapshotSection() {
  const now = useMemo(() => utcNowYm(), [])
  const [year, setYear] = useState(now.year)
  const [month, setMonth] = useState(now.month)
  const [data, setData] = useState<SnapshotPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const query = `period=month&year=${year}&month=${month}`

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/leaderboard-snapshot?${query}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      const json = (await res.json().catch(() => ({}))) as SnapshotPayload & { error?: string }
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'Could not load leaderboard snapshot')
        setData(null)
        return
      }
      setData(json)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  const ticketsBoard = data?.boards.find((b) => b.key === 'ticketsPurchased')

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Leaderboard snapshot</CardTitle>
          <CardDescription>
            Verify monthly standings before prize payouts (e.g. July ticket challenge). Uses the same rules as the public
            leaderboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">UTC year</span>
              <input
                type="number"
                min={2024}
                max={2100}
                value={year}
                onChange={(e) => setYear(Number.parseInt(e.target.value, 10) || now.year)}
                className="min-h-[44px] rounded-md border border-input bg-background px-3 py-2 touch-manipulation"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">UTC month</span>
              <input
                type="number"
                min={1}
                max={12}
                value={month}
                onChange={(e) => setMonth(Number.parseInt(e.target.value, 10) || now.month)}
                className="min-h-[44px] rounded-md border border-input bg-background px-3 py-2 touch-manipulation"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px] touch-manipulation"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
              Refresh
            </Button>
            <Button type="button" variant="secondary" className="min-h-[44px] touch-manipulation" asChild>
              <a
                href={`/api/admin/leaderboard-snapshot?${query}&format=csv&board=ticketsPurchased`}
                download
              >
                <Download className="h-4 w-4" aria-hidden />
                Export tickets CSV
              </a>
            </Button>
            <Button type="button" variant="outline" className="min-h-[44px] touch-manipulation" asChild>
              <a href={`/api/admin/leaderboard-snapshot?${query}&format=csv`} download>
                <Download className="h-4 w-4" aria-hidden />
                Export all boards
              </a>
            </Button>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {loading && !data ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading snapshot…
            </div>
          ) : null}

          {data ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{data.period.label}</span>
                {data.period.leaderboardRules ? ` · ${data.period.leaderboardRules} rules` : null}
                {' · '}
                Snapshot {new Date(data.snapshotAt).toLocaleString()}
              </p>
              {ticketsBoard ? (
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full min-w-[320px] text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-border/60 bg-muted/30">
                        <th className="px-3 py-2 font-medium">Rank</th>
                        <th className="px-3 py-2 font-medium">Player</th>
                        <th className="px-3 py-2 font-medium text-right">Tickets</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ticketsBoard.rows.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-4 text-muted-foreground">
                            No qualifying ticket purchases in this period yet.
                          </td>
                        </tr>
                      ) : (
                        ticketsBoard.rows.map((row) => (
                          <tr key={row.wallet} className="border-b border-border/40 last:border-0">
                            <td className="px-3 py-2 tabular-nums">{row.rank}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{row.displayName ?? '—'}</div>
                              <div className="font-mono text-[11px] text-muted-foreground break-all">{row.wallet}</div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{row.value}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
