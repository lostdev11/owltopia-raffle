import type { Metadata } from 'next'

import { CreatorLaunchesClient } from '@/components/owl-center/CreatorLaunchesClient'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `My Launches | Owl Center | ${PLATFORM_NAME}`,
  description: 'Edit mint details for your Owl Center collections — prices, phases, and schedule.',
}

export default function CreatorLaunchesPage() {
  return <CreatorLaunchesClient />
}
