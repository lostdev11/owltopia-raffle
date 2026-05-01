import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import {
  getRaffleBySlug,
  getEntriesByRaffleId,
  selectWinner,
  isRaffleEligibleToDraw,
  canSelectWinner,
  getRaffleMinimum,
} from '@/lib/db/raffles'
import { hasExhaustedMinThresholdTimeExtensions } from '@/lib/raffles/ticket-escrow-policy'
import { buildMinThresholdMissExtensionPatch } from '@/lib/raffles/min-threshold-extension'
import { enrichRafflesWithCreatorHolder } from '@/lib/raffles/enrich-raffles-with-holder'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { RaffleDetailClient } from '@/components/RaffleDetailClient'
import { notFound } from 'next/navigation'
import { PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'
import { resolveRaffleShareOgImage } from '@/lib/resolve-raffle-share-og-image'
import { getAdminRole } from '@/lib/db/admins'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { canViewerSeeRafflePending } from '@/lib/raffles/visibility'

// Force dynamic rendering to prevent caching stale data
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SITE_URL = getSiteBaseUrl()

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const raffle = await getRaffleBySlug(slug)
  if (!raffle) {
    return { title: `Raffle Not Found | ${PLATFORM_NAME}` }
  }

  const title = `${raffle.title} | ${PLATFORM_NAME}`
  const description =
    raffle.description?.replace(/\s+/g, ' ').trim().slice(0, 200) ||
    `Enter the raffle for ${raffle.title}. Trusted raffles with full transparency.`
  const canonicalUrl = `${SITE_URL}/raffles/${raffle.slug}`
  const ogImage = resolveRaffleShareOgImage(raffle)

  const linkOnly = raffle.list_on_platform === false
  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    ...(linkOnly
      ? { robots: { index: false, follow: true } as const }
      : {}),
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      siteName: PLATFORM_NAME,
      title,
      description,
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      // Explicit image object so X shows the raffle image in the share card
      images: [{ url: ogImage.url, width: 1200, height: 630, alt: ogImage.alt }],
    },
    // Root layout sets twitter:url to the homepage. Match og:url (giveaway pages already do
    // this) so X’s crawler doesn’t see a home URL on a per-raffle card. Preserve layout `other` keys
    // in case the child’s `other` object replaces the parent’s at build time.
    other: { 'twitter:url': canonicalUrl, 'mobile-web-app-capable': 'yes' },
  }
}

export default async function RaffleDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  let raffle = await getRaffleBySlug(slug)
  
  if (!raffle) {
    notFound()
  }

  // Pending NFT raffles should only be visible to admins and the raffle creator.
  const sessionValue = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  const session = parseSessionCookieValue(sessionValue)
  const viewerWallet = session?.wallet ?? null
  const viewerIsAdmin = viewerWallet ? (await getAdminRole(viewerWallet)) !== null : false
  if (!canViewerSeeRafflePending(raffle, viewerWallet, viewerIsAdmin)) {
    notFound()
  }

  // Check if raffle has ended and doesn't have a winner yet
  // Use end_time only: after restore, end_time is the extended time.
  const now = new Date()
  const endTimeToCheck = new Date(raffle.end_time)
  const hasEnded = endTimeToCheck <= now
  const hasNoWinner = !raffle.winner_wallet && !raffle.winner_selected_at
  // Match `/api/cron/draw-ended-raffles`: draw by status, not `is_active` alone (that flag is mainly for ticket sales).
  // NFT raffles must have prize in escrow before a draw, same as `getEndedRafflesWithoutWinner`.
  const mayAutoDraw =
    (raffle.status === 'live' ||
      raffle.status === 'ready_to_draw' ||
      raffle.status === 'pending_min_not_met') &&
    !(raffle.prize_type === 'nft' && !raffle.prize_deposited_at)

  if (hasEnded && hasNoWinner && mayAutoDraw) {
    try {
      // Get entries to check eligibility
      const entries = await getEntriesByRaffleId(raffle.id)
      const { updateRaffle } = await import('@/lib/db/raffles')

      // Check if raffle can have a winner selected (threshold met and at least one confirmed ticket)
      const canDraw = canSelectWinner(raffle, entries)

      if (canDraw) {
        // Automatically select a winner based on ticket quantities
        const winnerWallet = await selectWinner(raffle.id)
        
        if (winnerWallet) {
          // Refresh raffle data to get updated winner information
          raffle = await getRaffleBySlug(slug)
          if (!raffle) {
            notFound()
          }
        }
      } else {
        // Ticket threshold (min_tickets) not met: one extension, then failed_refund + NFT return
        const hasMinTickets = getRaffleMinimum(raffle) != null
        const meetsMinTickets = hasMinTickets ? isRaffleEligibleToDraw(raffle, entries) : false

        if (hasMinTickets && !meetsMinTickets) {
          if (hasExhaustedMinThresholdTimeExtensions(raffle)) {
            const { finalizeMinThresholdTerminalFailure } = await import(
              '@/lib/raffles/min-threshold-terminal'
            )
            await finalizeMinThresholdTerminalFailure(raffle.id)
            raffle = await getRaffleBySlug(slug)
            if (!raffle) {
              notFound()
            }
          } else {
            await updateRaffle(raffle.id, buildMinThresholdMissExtensionPatch(raffle))

            raffle = await getRaffleBySlug(slug)
            if (!raffle) {
              notFound()
            }
          }
        } else if (!hasMinTickets) {
          if (raffle.status !== 'ready_to_draw') {
            await updateRaffle(raffle.id, { status: 'ready_to_draw' })
            raffle = await getRaffleBySlug(slug)
            if (!raffle) {
              notFound()
            }
          }
        }
      }
    } catch (error) {
      // Log error but don't fail the page - winner selection can be retried
      console.error('Error auto-selecting winner for raffle:', error)
    }
  }

  // Ensure raffle is not null before proceeding
  if (!raffle) {
    notFound()
  }

  const entries = await getEntriesByRaffleId(raffle.id)
  const owlVisionScore = calculateOwlVisionScore(raffle, entries)
  const [enrichedRaffle] = await enrichRafflesWithCreatorHolder([raffle])

  return (
    <RaffleDetailClient
      key={enrichedRaffle.id}
      raffle={enrichedRaffle}
      entries={entries}
      owlVisionScore={owlVisionScore}
    />
  )
}
