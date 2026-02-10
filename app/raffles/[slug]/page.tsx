import type { Metadata } from 'next'
import { getRaffleBySlug, getEntriesByRaffleId, selectWinner, isRaffleEligibleToDraw, canSelectWinner } from '@/lib/db/raffles'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { RaffleDetailClient } from '@/components/RaffleDetailClient'
import { notFound } from 'next/navigation'

// Force dynamic rendering to prevent caching stale data
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.owltopia.xyz').replace(/\/$/, '')
const DEFAULT_OG_IMAGE = `${SITE_URL}/icon.png`

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
    return { title: 'Raffle Not Found | Owl Raffle' }
  }

  const title = `${raffle.title} | Owl Raffle`
  const description =
    raffle.description?.replace(/\s+/g, ' ').trim().slice(0, 200) ||
    `Enter the raffle for ${raffle.title}. Trusted raffles with full transparency.`
  const canonicalUrl = `${SITE_URL}/raffles/${raffle.slug}`
  const imageUrl = absoluteImageUrl(raffle.image_url)

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      siteName: 'Owl Raffle',
      title,
      description,
      images: imageUrl
        ? [
            {
              url: imageUrl,
              width: 1200,
              height: 630,
              alt: raffle.title,
            },
          ]
        : [
            {
              url: DEFAULT_OG_IMAGE,
              width: 512,
              height: 512,
              alt: 'Owl Raffle',
              type: 'image/png',
            },
          ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: imageUrl ? [imageUrl] : [DEFAULT_OG_IMAGE],
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

  // Check if raffle has ended and doesn't have a winner yet
  // Use end_time only: after restore, end_time is the extended time; original_end_time is for 7-day rule only.
  const now = new Date()
  const endTimeToCheck = new Date(raffle.end_time)
  const hasEnded = endTimeToCheck <= now
  const hasNoWinner = !raffle.winner_wallet && !raffle.winner_selected_at

  if (hasEnded && hasNoWinner && raffle.is_active) {
    try {
      // Get entries to check eligibility
      const entries = await getEntriesByRaffleId(raffle.id)
      const { updateRaffle } = await import('@/lib/db/raffles')
      
      // Check if raffle can have a winner selected (min tickets met AND 7 days passed)
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
        // Check if min tickets are not met - if so, extend the raffle by 7 days from current end
        const isEligible = isRaffleEligibleToDraw(raffle, entries)
        
        if (!isEligible) {
          // Min tickets not met - extend raffle by 7 days from current end_time (not original)
          const originalEndTime = raffle.original_end_time || raffle.end_time
          const newEndTime = new Date(raffle.end_time)
          newEndTime.setDate(newEndTime.getDate() + 7)
          
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
        } else {
          // Min tickets met but 7 days haven't passed - update to ready_to_draw
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

  return (
    <RaffleDetailClient
      raffle={raffle}
      entries={entries}
      owlVisionScore={owlVisionScore}
    />
  )
}
