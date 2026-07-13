import type { Metadata } from 'next'

import { OwlCenterAdminGate } from '@/components/owl-center/OwlCenterAdminGate'
import { OwlGeneratorPageClient } from '@/components/owl-center/generator/OwlGeneratorPageClient'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Owl Generator | Owl Center | ${PLATFORM_NAME}`,
  description:
    'Upload trait layers, set compatibility rules, preview NFT composites, and export Sugar-ready batches for Owl Center launches.',
}

type PageProps = {
  searchParams?: Promise<{ gen2?: string }>
}

export default async function OwlCenterGeneratorPage({ searchParams }: PageProps) {
  const sp = searchParams ? await searchParams : {}
  const gen2Mode = sp.gen2 === '1' || sp.gen2 === 'true'

  return (
    <OwlCenterAdminGate
      allowPartners={!gen2Mode}
      title={gen2Mode ? 'Gen2 Generator' : 'Owl Generator'}
      subtitle={gen2Mode ? 'Export and stage Gen2 assets in one flow.' : 'Trait layers, rules, and Sugar export.'}
    >
      <OwlGeneratorPageClient gen2Mode={gen2Mode} />
    </OwlCenterAdminGate>
  )
}
