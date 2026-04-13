import type { Metadata } from 'next'
import { OwlCouncilClient } from '@/components/OwlCouncilClient'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Owl Council — ${PLATFORM_NAME}`,
  description: 'Stake OWL, create proposals, and vote with Owltopia on-chain governance.',
}

export default function OwlCouncilPage() {
  return <OwlCouncilClient />
}
