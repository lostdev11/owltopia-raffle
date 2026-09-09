import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import { getMilestonesByRaffleId } from '@/lib/db/raffle-milestones'
import { calculateOwlVisionScore } from '@/lib/owl-vision'
import { EditRaffleForm } from '@/components/EditRaffleForm'
import { AdminRaffleActions } from '@/components/AdminRaffleActions'
import { getAdminRole } from '@/lib/db/admins'
import { shouldUseEditRaffleFormAdminView } from '@/lib/admin/raffle-admin-view'
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
  const milestones = await getMilestonesByRaffleId(raffle.id)
  const hasConfirmedEntries = entries.some((entry) => entry.status === 'confirmed')

  const endTimeMs = new Date(raffle.end_time).getTime()
  const endTimePassed = Number.isFinite(endTimeMs) && endTimeMs <= Date.now()

  const useEditForm = shouldUseEditRaffleFormAdminView({
    status,
    hasConfirmedEntries,
    milestoneCount: milestones.length,
    endTimePassed,
  })

  if (useEditForm) {
    const owlVisionScore = calculateOwlVisionScore(raffle, entries)
    return (
      <EditRaffleForm raffle={raffle} entries={entries} owlVisionScore={owlVisionScore} />
    )
  }

  // Non-draft (or live milestone raffles): cancel, milestone escrow return, refunds, delete
  return (
    <AdminRaffleActions
      raffle={raffle}
      entries={entries}
      milestones={milestones}
      adminRole={role}
    />
  )
}
