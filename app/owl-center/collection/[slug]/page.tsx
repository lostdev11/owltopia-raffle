import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { CollectionMintPageClient } from '@/components/owl-center/CollectionMintPageClient'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { PLATFORM_NAME } from '@/lib/site-config'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  if (slug === 'gen2') {
    return { title: `Owltopia Gen2 | Owl Center | ${PLATFORM_NAME}` }
  }
  const launch = await getOwlCenterLaunchBySlug(slug)
  return {
    title: launch ? `${launch.name} | Owl Center | ${PLATFORM_NAME}` : `Collection | ${PLATFORM_NAME}`,
    description: launch?.description ?? `Mint ${launch?.name ?? 'collection'} on Owl Center`,
  }
}

export default async function OwlCenterCollectionSlugPage({ params }: Props) {
  const { slug } = await params
  if (slug === 'gen2') {
    redirect('/owl-center/collection/gen2')
  }

  const launch = await getOwlCenterLaunchBySlug(slug)
  if (!launch) notFound()

  if (launch.mint_mode === 'public_simple') {
    return <CollectionMintPageClient slug={slug} launchName={launch.name} />
  }

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // COLLECTION"
      title={launch.name}
      subtitle="This collection is registered but uses a custom mint flow."
    >
      <p className="font-mono text-sm text-[#9BA8B4]">
        Mint UX for this slug is not yet on the public console. Contact Owltopia ops for launch details.
      </p>
      <Link
        href="/owl-center"
        className="mt-6 inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 px-5 text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/10"
      >
        ← Owl Center
      </Link>
    </OwlCenterShell>
  )
}
