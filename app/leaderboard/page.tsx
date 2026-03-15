'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Trophy, Ticket, PlusCircle, Loader2, Medal } from 'lucide-react'

type LeaderboardEntry = {
  rank: number
  wallet: string
  value: number
}

type LeaderboardData = {
  rafflesEntered: LeaderboardEntry[]
  rafflesCreated: LeaderboardEntry[]
  ticketsSold: LeaderboardEntry[]
}

function formatWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

function LeaderboardTable({
  title,
  description,
  entries,
  valueLabel,
  icon: Icon,
  displayNames,
}: {
  title: string
  description: string
  entries: LeaderboardEntry[]
  valueLabel: string
  icon: React.ElementType
  displayNames: Record<string, string>
}) {
  return (
    <Card className="border-green-500/20 bg-black/40">
      <CardHeader className="pb-2 sm:pb-6">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Icon className="h-5 w-5 text-green-500 shrink-0" />
          {title}
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm py-4">No data yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[240px]">
              <thead>
                <tr className="border-b border-green-500/20">
                  <th className="text-left py-2.5 sm:py-2 font-medium w-10 sm:w-12">#</th>
                  <th className="text-left py-2.5 sm:py-2 font-medium">Name</th>
                  <th className="text-right py-2.5 sm:py-2 font-medium">{valueLabel}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={`${e.wallet}-${e.rank}`} className="border-b border-border/50">
                    <td className="py-3 sm:py-2 align-middle">
                      {e.rank <= 3 ? (
                        <Medal
                          className={`h-5 w-5 inline ${
                            e.rank === 1
                              ? 'text-amber-400'
                              : e.rank === 2
                                ? 'text-slate-300'
                                : 'text-amber-700'
                          }`}
                          aria-label={`Rank ${e.rank}`}
                        />
                      ) : (
                        <span className="text-muted-foreground">{e.rank}</span>
                      )}
                    </td>
                    <td className="py-3 sm:py-2 text-xs sm:text-sm align-middle" title={e.wallet}>
                      {displayNames[e.wallet] ? (
                        <span className="font-medium">{displayNames[e.wallet]}</span>
                      ) : (
                        <span className="font-mono">{formatWallet(e.wallet)}</span>
                      )}
                    </td>
                    <td className="py-3 sm:py-2 text-right font-medium align-middle">{e.value.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardData | null>(null)
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/leaderboard', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load leaderboard')
        return res.json()
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false))
  }, [])

  // Fetch display names for all leaderboard wallets (set in My Dashboard)
  useEffect(() => {
    if (!data) return
    const wallets = new Set<string>()
    data.rafflesEntered.forEach((e) => wallets.add(e.wallet))
    data.rafflesCreated.forEach((e) => wallets.add(e.wallet))
    data.ticketsSold.forEach((e) => wallets.add(e.wallet))
    const list = [...wallets].slice(0, 200)
    if (list.length === 0) return
    const q = list.join(',')
    fetch(`/api/profiles?wallets=${encodeURIComponent(q)}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((map: Record<string, string>) => setDisplayNames(map))
      .catch(() => setDisplayNames({}))
  }, [data])

  return (
    <div className="container mx-auto py-6 sm:py-8 px-3 sm:px-4 max-w-5xl min-h-0">
      <div className="flex items-center gap-3 sm:gap-4 mb-6">
        <Link href="/raffles" className="inline-flex">
          <Button variant="ghost" size="sm" className="touch-manipulation min-h-[44px] min-w-[44px] sm:min-w-0 px-3 sm:px-4 text-sm sm:text-base">
            <ArrowLeft className="mr-2 h-4 w-4 shrink-0" />
            Back to Raffles
          </Button>
        </Link>
      </div>

      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <Trophy className="h-6 w-6 sm:h-8 sm:w-8 text-green-500 shrink-0" />
          Leaderboard
        </h1>
        <p className="text-muted-foreground mt-1 text-sm sm:text-base">
          Top 10 platform users by raffles entered, raffles created, and tickets sold.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
          Loading leaderboard…
        </div>
      )}

      {error && (
        <p className="text-destructive py-4">{error}</p>
      )}

      {!loading && !error && data && (
        <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-3">
          <LeaderboardTable
            title="Most raffles entered"
            description="Users with the most distinct raffles participated in (confirmed entries). Display names are set in My Dashboard."
            entries={data.rafflesEntered}
            valueLabel="Raffles"
            icon={Ticket}
            displayNames={displayNames}
          />
          <LeaderboardTable
            title="Most raffles created"
            description="Creators who have launched the most raffles."
            entries={data.rafflesCreated}
            valueLabel="Raffles"
            icon={PlusCircle}
            displayNames={displayNames}
          />
          <LeaderboardTable
            title="Most tickets sold"
            description="Creators whose raffles have sold the most tickets (confirmed entries)."
            entries={data.ticketsSold}
            valueLabel="Tickets"
            icon={Trophy}
            displayNames={displayNames}
          />
        </div>
      )}
    </div>
  )
}
