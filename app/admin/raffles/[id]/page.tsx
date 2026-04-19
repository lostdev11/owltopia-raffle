import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { EditRaffleForm } from '@/components/EditRaffleForm'
import { AdminRaffleActions } from '@/components/AdminRaffleActions'
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

  const status = (raffle.status ?? '').trim().toLowerCase()
  const entries = await getEntriesByRaffleId(raffle.id)
  const hasConfirmedEntries = entries.some((entry) => entry.status === 'confirmed')

  // Draft: show edit form
  if (status === 'draft') {
    const owlVisionScore = calculateOwlVisionScore(raffle, entries)
    return (
      <EditRaffleForm raffle={raffle} entries={entries} owlVisionScore={owlVisionScore} />
    )
  }

  // Safety override: allow time corrections for live/ready_to_draw only when
  // there are no confirmed tickets yet.
  if (
    (status === 'live' || status === 'ready_to_draw') &&
    !hasConfirmedEntries
  ) {
    const owlVisionScore = calculateOwlVisionScore(raffle, entries)
    return (
      <EditRaffleForm raffle={raffle} entries={entries} owlVisionScore={owlVisionScore} />
    )
  }

  // Non-draft: show admin actions (return NFT, cancel, refund list, delete)
  return <AdminRaffleActions raffle={raffle} entries={entries} />
}
