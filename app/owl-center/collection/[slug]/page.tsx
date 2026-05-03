import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

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
  }
}

export default async function OwlCenterCollectionSlugPage({ params }: Props) {
  const { slug } = await params
  if (slug === 'gen2') {
    redirect('/owl-center/collection/gen2')
  }

  const launch = await getOwlCenterLaunchBySlug(slug)
  if (!launch) notFound()

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // COLLECTION"
      title={launch.name}
      subtitle="Hub route — mint UX may differ per collection. Gen2 uses the dedicated mint console."
    >
      <p className="font-mono text-sm text-[#9BA8B4]">
        This collection slug is registered in Owl Center. For Owltopia Gen2 use the flagship mint page.
      </p>
      <Link
        href="/owl-center/collection/gen2"
        className="mt-6 inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 px-5 text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/10"
      >
        Open Gen2 mint console
      </Link>
    </OwlCenterShell>
  )
}
