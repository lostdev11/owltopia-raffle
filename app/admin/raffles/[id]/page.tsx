import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { EditRaffleForm } from '@/components/EditRaffleForm'
import { getAdminRole } from '@/lib/db/admins'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'

export default async function EditRafflePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = parseSessionCookieValue((await cookies()).get(SESSION_COOKIE_NAME)?.value)
  const { id } = await params
  const raffle = await getRaffleById(id)

  if (!raffle) {
    notFound()
  }

  const role = session ? await getAdminRole(session.wallet) : null
  if (!session || !role) {
    redirect('/admin/raffles/new')
  }
  if (role === 'full') {
    // Full admin can edit any raffle
  } else if (role === 'raffle_creator') {
    const creator = (raffle.created_by ?? '').trim()
    if (creator !== session.wallet.trim()) {
      redirect('/admin/raffles/new')
    }
  } else {
    redirect('/admin/raffles/new')
  }

  const entries = await getEntriesByRaffleId(raffle.id)
  const owlVisionScore = calculateOwlVisionScore(raffle, entries)

  return (
    <EditRaffleForm raffle={raffle} entries={entries} owlVisionScore={owlVisionScore} />
  )
}
