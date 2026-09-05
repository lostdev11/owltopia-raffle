'use client'

import Link from 'next/link'

import { useCollectionCardCtaLabel } from '@/components/owl-center/CollectionCardLabels'
import { owlCenterBtnGhost, owlCenterBtnPrimary } from '@/components/owl-center/owl-center-cta-styles'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

function hrefForLaunch(slug: string): string {
  return `/owl-center/collection/${slug}`
}

function ctaHref(launch: OwlCenterLaunchPublic): string {
  if (launch.active_phase === 'TRADING_ACTIVE') {
    return launch.orbis_url || launch.magic_eden_url || launch.tensor_url || hrefForLaunch(launch.slug)
  }
  return hrefForLaunch(launch.slug)
}

/** Primary CTA + Hub — "Opens …" times use the browser timezone. */
export function CollectionCardActions({ launch }: { launch: OwlCenterLaunchPublic }) {
  const href = ctaHref(launch)
  const internal = href.startsWith('/')
  const label = useCollectionCardCtaLabel(launch)

  return (
    <div className="mt-auto flex flex-wrap gap-2 pt-1">
      {internal ? (
        <Link href={href} className={`${owlCenterBtnPrimary} w-full sm:w-auto`}>
          {label}
        </Link>
      ) : (
        <a href={href} target="_blank" rel="noreferrer" className={`${owlCenterBtnPrimary} w-full sm:w-auto`}>
          {label}
        </a>
      )}
      <Link href={hrefForLaunch(launch.slug)} className={`${owlCenterBtnGhost} w-full sm:w-auto`}>
        Hub
      </Link>
    </div>
  )
}
