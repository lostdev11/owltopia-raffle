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
  if (role === 'full') {
    // Full admin can edit any raffle or use admin actions (return NFT, delete)
  } else if (role === 'raffle_creator') {
    const wallet = session.wallet.trim()
    const createdBy = (raffle.created_by ?? '').trim()
    const creatorWallet = (raffle.creator_wallet ?? '').trim()
    const isCreator = createdBy === wallet || creatorWallet === wallet
    if (!isCreator) {
      redirect('/admin/raffles/new')
    }
  } else {
    redirect('/admin/raffles/new')
  }

  const status = (raffle.status ?? '').trim().toLowerCase()
  const entries = await getEntriesByRaffleId(raffle.id)
  const hasConfirmedEntries = entries.some((entry) => entry.status === 'confirmed')

  // Draft: show edit form (creator or full admin)
  if (status === 'draft') {
    const owlVisionScore = calculateOwlVisionScore(raffle, entries)
    return (
      <EditRaffleForm raffle={raffle} entries={entries} owlVisionScore={owlVisionScore} />
    )
  }

  // Full admin safety override: allow time corrections for live/ready_to_draw only when
  // there are no confirmed tickets yet.
  if (
    role === 'full' &&
    (status === 'live' || status === 'ready_to_draw') &&
    !hasConfirmedEntries
  ) {
    const owlVisionScore = calculateOwlVisionScore(raffle, entries)
    return (
      <EditRaffleForm raffle={raffle} entries={entries} owlVisionScore={owlVisionScore} />
    )
  }

  // Non-draft + full admin: show admin actions (return NFT, cancel, refund list, delete)
  if (role === 'full') {
    return <AdminRaffleActions raffle={raffle} entries={entries} />
  }

  // Non-draft + raffle_creator: send to public page
  redirect(`/raffles/${raffle.slug}`)
}
