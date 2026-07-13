import type { Metadata } from 'next'

import { OwlCenterPartnersClient } from '@/components/admin/OwlCenterPartnersClient'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Launchpad Partners | Owl Vision | ${PLATFORM_NAME}`,
  description: 'Approve partner wallets for the Owl Center launchpad — launch wizard and Owl Generator access.',
}

export default function AdminOwlCenterPartnersPage() {
  return <OwlCenterPartnersClient />
}
