import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { EditRaffleForm } from '@/components/EditRaffleForm'
import { notFound } from 'next/navigation'

export default async function EditRafflePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const raffle = await getRaffleById(id)
  
  if (!raffle) {
    notFound()
  }

  const entries = await getEntriesByRaffleId(raffle.id)
  const owlVisionScore = calculateOwlVisionScore(raffle, entries)

  return (
    <EditRaffleForm raffle={raffle} entries={entries} owlVisionScore={owlVisionScore} />
  )
}
