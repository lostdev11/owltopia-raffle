'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import {
  Bird,
  CheckCircle2,
  Flag,
  Gauge,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Timer,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  RACE_ACCESS_MODE,
  RACE_DEFAULT_COURSE_ID,
  RACE_DEFAULT_SEASON_ID,
  RACE_ELIGIBLE_COLLECTIONS,
  RACE_OWL_MINT,
  canAdminPreviewRace,
  isRacePublic,
} from '@/lib/race/config'
import { RaceGame } from '@/components/race/RaceGame'

type AdminCheckState = 'idle' | 'loading' | 'allowed' | 'denied'

const featureCards = [
  {
    title: 'Run, jump, glide',
    description: 'Master an owl built for speed, precision, and limited flight.',
    icon: Bird,
  },
  {
    title: 'Chase your best time',
    description: 'Ordered checkpoints and verified splits keep every run accountable.',
    icon: Timer,
  },
  {
    title: 'Climb the season',
    description: 'Weekly time trials feed the Owltopia preseason leaderboard.',
    icon: Flag,
  },
]

export function RaceLanding() {
  const { connected } = useWallet()
  const [prototypeOpen, setPrototypeOpen] = useState(false)
  const [adminCheck, setAdminCheck] = useState<AdminCheckState>(
    RACE_ACCESS_MODE === 'admin' ? 'loading' : 'idle'
  )

  useEffect(() => {
    if (RACE_ACCESS_MODE !== 'admin') return

    let cancelled = false
    fetch('/api/admin/check?session=1', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) return { isAdmin: false }
        return response.json() as Promise<{ isAdmin?: boolean }>
      })
      .then((result) => {
        if (!cancelled) setAdminCheck(result.isAdmin ? 'allowed' : 'denied')
      })
      .catch(() => {
        if (!cancelled) setAdminCheck('denied')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const accessAllowed =
    isRacePublic() || canAdminPreviewRace(adminCheck === 'allowed')
  const accessChecking =
    RACE_ACCESS_MODE === 'admin' && adminCheck === 'loading'

  if (!accessAllowed) {
    return (
      <main className="relative flex min-h-[70vh] items-center justify-center overflow-hidden px-4 py-16">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.18),transparent_45%)]" />
        <Card className="relative w-full max-w-xl border-emerald-500/20 bg-black/70 text-center">
          <CardHeader>
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10">
              <LockKeyhole className="h-7 w-7 text-emerald-300" />
            </div>
            <CardTitle className="text-2xl">Flight League is in the nest</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {accessChecking
                ? 'Checking preview access…'
                : RACE_ACCESS_MODE === 'admin'
                  ? 'The first course is currently limited to Owltopia administrators.'
                  : 'The race route is staged but not open yet. Check back when holder preseason access begins.'}
            </p>
            <Button asChild variant="outline">
              <Link href="/">Return to Owltopia</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="relative overflow-hidden">
      <section className="relative isolate min-h-[72vh] px-4 py-16 sm:py-24">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(34,197,94,0.28),transparent_48%),linear-gradient(to_bottom,rgba(0,0,0,0.1),rgba(0,0,0,0.92))]" />
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center text-center">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
            <Sparkles className="h-4 w-4" />
            Holder preseason
          </span>
          <h1 className="max-w-4xl font-display text-5xl uppercase tracking-wide text-white sm:text-7xl">
            Owltopia Flight League
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            Run the forest, manage your stamina, catch the perfect glide, and
            chase a verified place on the weekly leaderboard.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              className="min-w-44"
              onClick={() => setPrototypeOpen((open) => !open)}
            >
              <Gauge className="mr-2 h-5 w-5" />
              {prototypeOpen ? 'Close prototype' : 'Open prototype'}
            </Button>
            {!connected ? (
              <p className="self-center text-sm text-zinc-400">
                Connect your holder wallet above to prepare for access.
              </p>
            ) : (
              <p className="flex items-center self-center text-sm text-emerald-300">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Wallet connected
              </p>
            )}
          </div>

          <div className="mt-14 grid w-full gap-4 text-left md:grid-cols-3">
            {featureCards.map(({ title, description, icon: Icon }) => (
              <Card
                key={title}
                className="border-white/10 bg-black/55 backdrop-blur"
              >
                <CardHeader>
                  <Icon className="mb-2 h-7 w-7 text-emerald-300" />
                  <CardTitle className="text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-8 grid w-full gap-3 rounded-xl border border-white/10 bg-black/45 p-4 text-left text-xs text-zinc-400 sm:grid-cols-2 lg:grid-cols-4">
            <span>
              <strong className="block text-zinc-200">Access</strong>
              Owltopia holders
            </span>
            <span>
              <strong className="block text-zinc-200">Season</strong>
              {RACE_DEFAULT_SEASON_ID}
            </span>
            <span>
              <strong className="block text-zinc-200">Course</strong>
              {RACE_DEFAULT_COURSE_ID}
            </span>
            <span>
              <strong className="block text-zinc-200">Collections configured</strong>
              {RACE_ELIGIBLE_COLLECTIONS.length || 'Pending'}
            </span>
          </div>

          <p className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
            <ShieldCheck className="h-4 w-4" />
            OWL utility mint configured: {RACE_OWL_MINT.slice(0, 6)}…
            {RACE_OWL_MINT.slice(-4)}
          </p>

          {prototypeOpen ? (
            <div className="mt-8 w-full text-left">
              <RaceGame />
              <p className="mt-3 text-center text-xs text-zinc-500">
                Phase 1 gray-box controller. The rigged owl model will replace
                the placeholder without changing movement or physics.
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}
