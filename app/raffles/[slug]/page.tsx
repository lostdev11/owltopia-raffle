import { getRaffleBySlug, getEntriesByRaffleId, selectWinner, isRaffleEligibleToDraw, canSelectWinner } from '@/lib/db/raffles'
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
  // For extended raffles, check original_end_time if it exists
  const now = new Date()
  const endTimeToCheck = raffle.original_end_time ? new Date(raffle.original_end_time) : new Date(raffle.end_time)
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
          raffle = await getRaffleBySlug(params.slug)
          if (!raffle) {
            notFound()
          }
        }
      } else {
        // Check if min tickets are not met - if so, extend the raffle by 7 days
        const isEligible = isRaffleEligibleToDraw(raffle, entries)
        
        if (!isEligible) {
          // Min tickets not met - extend raffle by 7 days
          // Store original_end_time if not already set
          const originalEndTime = raffle.original_end_time || raffle.end_time
          const newEndTime = new Date(endTime)
          newEndTime.setDate(newEndTime.getDate() + 7)
          
          await updateRaffle(raffle.id, {
            original_end_time: originalEndTime,
            end_time: newEndTime.toISOString(),
            status: 'pending_min_not_met'
          })
          
          // Refresh raffle data
          raffle = await getRaffleBySlug(params.slug)
          if (!raffle) {
            notFound()
          }
        } else {
          // Min tickets met but 7 days haven't passed - just update status if needed
          if (raffle.status !== 'pending_min_not_met') {
            await updateRaffle(raffle.id, { status: 'pending_min_not_met' })
            raffle = await getRaffleBySlug(params.slug)
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
