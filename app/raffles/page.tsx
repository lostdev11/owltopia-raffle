/**
 * Raffles list page (server component).
 * - Public list: fetches ONLY raffles (no entries on server). Entries load client-side via RafflesList poll.
 * - Avoids timeout: server does 1 Supabase query instead of 1 + N×entries, so page renders quickly.
 */
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { getRafflesViaRest, promoteDraftRafflesToLive, type GetRafflesResult } from '@/lib/db/raffles'
import { getSupabaseConfigError } from '@/lib/supabase'
import { RafflesPageClient } from './RafflesPageClient'
import type { Raffle, Entry } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0
/** Stay within Vercel serverless limit (10s on Hobby) so we don't get 500/502 from platform timeout */
export const maxDuration = 10

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const OG_IMAGE_PATH = (process.env.NEXT_PUBLIC_OG_IMAGE || '').trim() || '/og-image.png'
const OG_IMAGE = `${SITE_URL}${OG_IMAGE_PATH.startsWith('/') ? OG_IMAGE_PATH : `/${OG_IMAGE_PATH}`}`
const OG_ALT = 'Owl Raffle - Trusted raffles with full transparency. Every entry verified on-chain.'
const OG_DESCRIPTION = `Browse and enter trusted raffles. Every entry verified on-chain. ${SITE_URL}/raffles`

export const metadata: Metadata = {
  title: 'Raffles | Owl Raffle',
  description: OG_DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/raffles` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/raffles`,
    siteName: 'Owl Raffle',
    title: 'Owl Raffle',
    description: OG_DESCRIPTION,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_ALT, type: 'image/png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Owl Raffle',
    description: OG_DESCRIPTION,
    images: [{ url: OG_IMAGE, alt: OG_ALT, width: 1200, height: 630 }],
  },
}

type RaffleWithEntries = Array<{ raffle: Raffle; entries: Entry[] }>

function toRaffleWithEntries(raffles: Raffle[]): RaffleWithEntries {
  return raffles.map((raffle) => ({ raffle, entries: [] }))
}

// Runtime check: Supabase config must be present (e.g. Vercel env vars). No secrets exposed in UI.
export default async function RafflesPage() {
  try {
    const configError = getSupabaseConfigError()
    if (configError) {
      return (
        <div className="container mx-auto py-8 px-4">
          <div className="max-w-2xl mx-auto">
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-6">
              <h1 className="text-2xl font-bold text-destructive mb-4">Missing Supabase config</h1>
              <p className="text-destructive mb-4">{configError}</p>
              <p className="text-sm text-muted-foreground mb-4">
                Set <code className="bg-muted px-1 py-0.5 rounded">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
                <code className="bg-muted px-1 py-0.5 rounded">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your environment.
              </p>
              <p className="text-sm text-muted-foreground mt-4">See README.md for setup.</p>
            </div>
          </div>
        </div>
      )
    }

    // Promote any draft raffles whose start_time has passed to live (so they show as active)
    await promoteDraftRafflesToLive()

    // Single path: REST only. Fail fast so client fallback (API + direct Supabase) takes over.
    // Timeout under maxDuration (10s) so we respond before Vercel kills the request.
    const SERVER_FETCH_TIMEOUT_MS = 7_000
    let result: GetRafflesResult
    try {
      result = await Promise.race([
        getRafflesViaRest(false, {
          includeDraft: true,
          timeoutMs: 5_000,
          maxRetries: 1,
          perAttemptMs: 3_000,
        }),
        new Promise<GetRafflesResult>((_, reject) =>
          setTimeout(
            () => reject(new Error('Server fetch timed out')),
            SERVER_FETCH_TIMEOUT_MS
          )
        ),
      ])
    } catch (err) {
      result = {
        data: [],
        error: {
          message: err instanceof Error ? err.message : 'Server fetch timed out',
          code: 'TIMEOUT',
        },
      }
    }

    const { data: allRaffles, error: fetchError } = result
    if (fetchError) {
      return (
        <Suspense fallback={<RafflesLoadingFallback />}>
          <RafflesPageClient
            activeRafflesWithEntries={[]}
            futureRafflesWithEntries={[]}
            pastRafflesWithEntries={[]}
            fetchStatus="error"
            initialError={{ message: fetchError.message, code: fetchError.code }}
          />
        </Suspense>
      )
    }

    const now = new Date()
    const nowTime = now.getTime()
    const pastRaffles: Raffle[] = []
    const activeRaffles: Raffle[] = []
    const futureRaffles: Raffle[] = []

    // Bucket by status + times (status already filtered: live, ready_to_draw, completed — no draft)
    for (const raffle of allRaffles) {
      const startTime = new Date(raffle.start_time)
      const endTime = new Date(raffle.end_time)
      const startTimeMs = startTime.getTime()
      const endTimeMs = endTime.getTime()
      if (isNaN(startTimeMs) || isNaN(endTimeMs)) {
        pastRaffles.push(raffle)
        continue
      }
      if (raffle.winner_selected_at || raffle.status === 'completed') {
        pastRaffles.push(raffle)
        continue
      }
      if (raffle.status === 'ready_to_draw') {
        pastRaffles.push(raffle)
        continue
      }
      // Future: draft or live that haven't started yet — show for everyone
      if ((raffle.status === 'draft' || raffle.status === 'live') && startTimeMs > nowTime) {
        futureRaffles.push(raffle)
        continue
      }
      if (raffle.status === 'live' && startTimeMs <= nowTime && endTimeMs > nowTime) {
        activeRaffles.push(raffle)
        continue
      }
      pastRaffles.push(raffle)
    }

    const pastRafflesWithEntries = toRaffleWithEntries(pastRaffles)
    const activeRafflesWithEntries = toRaffleWithEntries(activeRaffles)
    const futureRafflesWithEntries = toRaffleWithEntries(futureRaffles)
    const totalCount = allRaffles.length
    const fetchStatus = totalCount === 0 ? 'empty' : 'success'

    return (
      <Suspense fallback={<RafflesLoadingFallback />}>
        <RafflesPageClient
          activeRafflesWithEntries={activeRafflesWithEntries}
          futureRafflesWithEntries={futureRafflesWithEntries}
          pastRafflesWithEntries={pastRafflesWithEntries}
          fetchStatus={fetchStatus}
          rafflesTotalCount={totalCount}
        />
      </Suspense>
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load raffles'
    return (
      <Suspense fallback={<RafflesLoadingFallback />}>
        <RafflesPageClient
          activeRafflesWithEntries={[]}
          futureRafflesWithEntries={[]}
          pastRafflesWithEntries={[]}
          fetchStatus="error"
          initialError={{ message, code: 'PAGE_ERROR' }}
        />
      </Suspense>
    )
  }
}

function RafflesLoadingFallback() {
  return (
    <div className="container mx-auto py-4 sm:py-6 md:py-8 px-3 sm:px-4">
      <div className="mb-6 sm:mb-8">
        <div className="h-9 sm:h-10 md:h-12 w-48 sm:w-56 bg-muted/50 rounded animate-pulse mb-2" />
        <div className="h-5 sm:h-6 w-72 sm:w-80 bg-muted/40 rounded animate-pulse" />
      </div>
      <div className="mb-8 sm:mb-12">
        <div className="h-7 sm:h-8 w-36 mb-4 sm:mb-6 bg-muted/50 rounded animate-pulse" />
        <p className="text-muted-foreground">Loading raffles...</p>
        <div className="mt-4 flex flex-col gap-3 max-w-md">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted/30 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
