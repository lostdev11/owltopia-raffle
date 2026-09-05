'use client'

import { useEffect, useState } from 'react'

import { PhaseBadge } from '@/components/owl-center/PhaseBadge'
import { StatusBadge } from '@/components/owl-center/StatusBadge'
import {
  launchCollectionCtaLabel,
  launchPublicPhaseBadgeLabel,
} from '@/lib/owl-center/launch-mint-open'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

/** Status + phase badges with CTA-open times formatted in the browser timezone. */
export function CollectionCardBadges({
  launch,
  presaleSoldOut = false,
}: {
  launch: OwlCenterLaunchPublic
  presaleSoldOut?: boolean
}) {
  const [scheduledPublicLabel, setScheduledPublicLabel] = useState<string | null>(null)

  useEffect(() => {
    setScheduledPublicLabel(launchPublicPhaseBadgeLabel(launch))
  }, [launch])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={launch.status} />
      <PhaseBadge
        phase={launch.active_phase}
        pulse={launch.active_phase === 'PRESALE' && !presaleSoldOut}
        presaleSoldOut={launch.slug === 'gen2' ? presaleSoldOut : false}
        overrideLabel={scheduledPublicLabel}
      />
    </div>
  )
}

/** Primary CTA label with "Opens …" times in the browser timezone. */
export function useCollectionCardCtaLabel(launch: OwlCenterLaunchPublic): string {
  const [label, setLabel] = useState(() => {
    // Avoid embedding a UTC-formatted date on the first paint; static labels are fine.
    if (launch.active_phase === 'TRADING_ACTIVE') return 'Trade Now'
    if (launch.active_phase === 'SOLD_OUT') return 'View Collection'
    if (launch.is_paused) return 'View Collection'
    if (launch.active_phase === 'PRESALE') return launch.slug === 'gen2' ? 'Mint Gen2' : 'Enter Presale'
    if (launch.active_phase === 'WHITELIST' || launch.active_phase === 'AIRDROP') return 'Mint Now'
    if (launch.active_phase === 'PUBLIC' || launch.status === 'PUBLIC') return '…'
    return 'View Collection'
  })

  useEffect(() => {
    setLabel(launchCollectionCtaLabel(launch))
  }, [launch])

  return label
}
