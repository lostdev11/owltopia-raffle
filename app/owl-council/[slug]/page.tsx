import { redirect } from 'next/navigation'

type Props = { params: Promise<{ slug: string }> }

export default async function OwlCouncilLegacyProposalPage({ params }: Props) {
  const { slug } = await params
  redirect(`/council/${encodeURIComponent(slug)}`)
}
