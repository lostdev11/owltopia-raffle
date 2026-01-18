import { getRaffleBySlug, getEntriesByRaffleId, selectWinner, isRaffleEligibleToDraw } from '@/lib/db/raffles'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { RaffleDetailClient } from '@/components/RaffleDetailClient'
import { notFound } from 'next/navigation'

// Force dynamic rendering to prevent caching stale data
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function RaffleDetailPage({
  params,
}: {
  params: { slug: string }
}) {
  let raffle = await getRaffleBySlug(params.slug)
  
  if (!raffle) {
    notFound()
  }

  // Check if raffle has ended and doesn't have a winner yet
  const now = new Date()
  const endTime = new Date(raffle.end_time)
  const hasEnded = endTime <= now
  const hasNoWinner = !raffle.winner_wallet && !raffle.winner_selected_at

  if (hasEnded && hasNoWinner && raffle.is_active) {
    try {
      // Get entries to check eligibility
      const entries = await getEntriesByRaffleId(raffle.id)
      
      // Check if raffle meets minimum requirements
      const isEligible = isRaffleEligibleToDraw(raffle, entries)
      
      if (isEligible) {
        // Automatically select a winner based on ticket quantities
        const winnerWallet = await selectWinner(raffle.id)
        
        if (winnerWallet) {
          // Refresh raffle data to get updated winner information
          raffle = await getRaffleBySlug(params.slug)
          if (!raffle) {
            notFound()
          }
        }
      } else {
        // Update status to pending_min_not_met if minimum not met
        const { updateRaffle } = await import('@/lib/db/raffles')
        if (raffle.status !== 'pending_min_not_met') {
          await updateRaffle(raffle.id, { status: 'pending_min_not_met' })
          raffle = await getRaffleBySlug(params.slug)
          if (!raffle) {
            notFound()
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
