import type { Metadata } from 'next'
import { Suspense } from 'react'

import { OwlCenterAdminGate } from '@/components/owl-center/OwlCenterAdminGate'
import { LaunchSubmissionWizard } from '@/components/owl-center/LaunchSubmissionWizard'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Submit Collection | Owl Center | ${PLATFORM_NAME}`,
  description: 'Submit a Solana collection for Owl Center review — assets, metadata, and marketplace readiness tracking.',
}

export default function OwlCenterLaunchSubmissionPage() {
  return (
    <OwlCenterAdminGate title="Submit collection" subtitle="Launch review queue and asset checklist.">
      <Suspense fallback={<div className="min-h-[40vh] bg-[#0F1419]" />}>
        <LaunchSubmissionWizard />
      </Suspense>
    </OwlCenterAdminGate>
  )
}
