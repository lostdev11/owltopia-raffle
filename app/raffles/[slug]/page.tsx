import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { getRaffleBySlug, getEntriesByRaffleId, selectWinner, isRaffleEligibleToDraw, canSelectWinner } from '@/lib/db/raffles'
import { enrichRafflesWithCreatorHolder } from '@/lib/raffles/enrich-raffles-with-holder'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { RaffleDetailClient } from '@/components/RaffleDetailClient'
import { notFound } from 'next/navigation'
import { PLATFORM_NAME, OG_ALT } from '@/lib/site-config'
import { getAdminRole } from '@/lib/db/admins'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { canViewerSeeRafflePending } from '@/lib/raffles/visibility'

// Force dynamic rendering to prevent caching stale data
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const DEFAULT_OG_IMAGE = `${SITE_URL}/api/og`

/** Per-raffle OG image URL (generated when raffle has no image_url). */
function raffleOgImageUrl(slug: string) {
  return `${SITE_URL}/raffles/${slug}/opengraph-image`
}

function absoluteImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl
  const base = SITE_URL.replace(/\/$/, '')
  const path = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`
  return `${base}${path}`
}

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
  // Absolute URL required so Discord/X and other crawlers can fetch the image for link previews.
  // Use raffle image when set; otherwise use per-raffle generated OG image (title + prize).
  const imageUrl = absoluteImageUrl(raffle.image_url)
  const ogImage = imageUrl
    ? { url: imageUrl, width: 1200, height: 630, alt: raffle.title }
    : { url: raffleOgImageUrl(raffle.slug), width: 1200, height: 630, alt: raffle.title, type: 'image/png' as const }

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
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
  const sessionValue = cookies().get(SESSION_COOKIE_NAME)?.value
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

  if (hasEnded && hasNoWinner && raffle.is_active) {
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
        // Threshold not met: only extend when a minimum is configured and not reached yet
        const hasMinTickets = raffle.min_tickets != null && raffle.min_tickets > 0
        const meetsMinTickets = hasMinTickets ? isRaffleEligibleToDraw(raffle, entries) : false

        if (hasMinTickets && !meetsMinTickets) {
          // Min tickets not met - extend raffle by its original duration (or 7 days fallback)
          const originalEndTime = raffle.original_end_time || raffle.end_time
          const startTimeMs = new Date(raffle.start_time).getTime()
          const originalEndMs = new Date(originalEndTime).getTime()
          const baseDurationMs = originalEndMs - startTimeMs
          const durationMs =
            baseDurationMs > 0 ? baseDurationMs : 7 * 24 * 60 * 60 * 1000

          const currentEndMs = new Date(raffle.end_time).getTime()
          const newEndTime = new Date(currentEndMs + durationMs)

          await updateRaffle(raffle.id, {
            original_end_time: originalEndTime,
            end_time: newEndTime.toISOString(),
            status: 'live',
          })

          // Refresh raffle data
          raffle = await getRaffleBySlug(slug)
          if (!raffle) {
            notFound()
          }
        } else if (!hasMinTickets) {
          // No minimum configured and either zero tickets or some other non-drawable state:
          // mark as ready_to_draw so admins can decide how to handle it.
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
      raffle={enrichedRaffle}
      entries={entries}
      owlVisionScore={owlVisionScore}
    />
  )
}
