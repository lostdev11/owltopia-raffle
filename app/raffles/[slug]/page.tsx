import { getRaffleBySlug, getEntriesByRaffleId } from '@/lib/db/raffles'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { RaffleDetailClient } from '@/components/RaffleDetailClient'
import { notFound } from 'next/navigation'

export default async function RaffleDetailPage({
  params,
}: {
  params: { slug: string }
}) {
  const raffle = await getRaffleBySlug(params.slug)
  
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
