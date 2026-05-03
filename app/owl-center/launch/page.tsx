import type { Metadata } from 'next'

import { LaunchSubmissionWizard } from '@/components/owl-center/LaunchSubmissionWizard'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Submit Collection | Owl Center | ${PLATFORM_NAME}`,
  description: 'Submit a Solana collection for Owl Center review — assets, metadata, and marketplace readiness tracking.',
}

export default function OwlCenterLaunchSubmissionPage() {
  return <LaunchSubmissionWizard />
}
