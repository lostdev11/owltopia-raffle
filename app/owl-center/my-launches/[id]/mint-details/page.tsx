import type { Metadata } from 'next'

import { CreatorMintDetailsClient } from '@/components/owl-center/CreatorMintDetailsClient'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Mint Details | Owl Center | ${PLATFORM_NAME}`,
  description: 'Configure mint prices, phase supplies, and schedule for your Owl Center collection.',
}

type Props = {
  params: Promise<{ id: string }>
}

export default async function CreatorMintDetailsPage({ params }: Props) {
  const { id } = await params
  return <CreatorMintDetailsClient launchId={id} />
}
