import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { CollectionMintPageClient } from '@/components/owl-center/CollectionMintPageClient'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { getOwlCenterLaunchBySlug } from '@/lib/db/owl-center-launch'
import { OG_IMAGE_CACHE_VERSION, PLATFORM_NAME, getSiteBaseUrl } from '@/lib/site-config'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  if (slug === 'gen2') {
    return { title: `Owltopia Gen2 | Owl Center | ${PLATFORM_NAME}` }
  }
  const launch = await getOwlCenterLaunchBySlug(slug)
  const title = launch ? `${launch.name} | Owl Center | ${PLATFORM_NAME}` : `Collection | ${PLATFORM_NAME}`
  const description = launch?.description ?? `Mint ${launch?.name ?? 'collection'} on Owl Center`

  const site = getSiteBaseUrl().replace(/\/$/, '')
  const canonicalUrl = `${site}/owl-center/collection/${encodeURIComponent(slug)}`
  // Per-collection OG art (the collection PFP) — overrides the platform raffle fallback.
  const ogImageUrl = `${canonicalUrl}/opengraph-image?v=${OG_IMAGE_CACHE_VERSION}`
  const ogAlt = launch ? `${launch.name} on Owl Center` : PLATFORM_NAME

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      type: 'website',
      url: canonicalUrl,
      siteName: PLATFORM_NAME,
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: ogAlt, type: 'image/png' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: ogAlt }],
    },
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
