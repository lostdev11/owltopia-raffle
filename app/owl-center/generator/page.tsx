import type { Metadata } from 'next'

import { OwlCenterAdminGate } from '@/components/owl-center/OwlCenterAdminGate'
import { OwlGeneratorPageClient } from '@/components/owl-center/generator/OwlGeneratorPageClient'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Owl Generator | Owl Center | ${PLATFORM_NAME}`,
  description:
    'Upload trait layers, set compatibility rules, preview NFT composites, and export Sugar-ready batches for Owl Center launches.',
}

export default function OwlCenterGeneratorPage() {
  return (
    <OwlCenterAdminGate title="Owl Generator" subtitle="Trait layers, rules, and Sugar export.">
      <OwlGeneratorPageClient />
    </OwlCenterAdminGate>
  )
}
