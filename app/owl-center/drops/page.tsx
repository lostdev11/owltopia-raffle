import type { Metadata } from 'next'

import { CollectionCard } from '@/components/owl-center/CollectionCard'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { listOwlCenterLaunchesPublic } from '@/lib/db/owl-center-launch'
import { getGen2PresaleSoldOutForDisplay } from '@/lib/gen2-presale/owl-center-presale-status'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Live Drops | Owl Center | ${PLATFORM_NAME}`,
  description: 'Active Owltopia Owl Center mints and launches — Solana only.',
}

export default async function OwlCenterDropsPage() {
  const [launches, presaleSoldOut] = await Promise.all([
    listOwlCenterLaunchesPublic(),
    getGen2PresaleSoldOutForDisplay(),
  ])
  const live = launches.filter((l) => l.status !== 'SOLD_OUT' && l.active_phase !== 'TRADING_ACTIVE')

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // DROPS"
      title="Live mints"
      subtitle="Solana-native launches tracked by Owl Center — presale, whitelist, public, and trading activation."
    >
      {live.length === 0 ? (
        <p className="font-mono text-sm text-[#5C6773]">No active primary mints — check trading or upcoming.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {live.map((l) => (
            <CollectionCard key={l.id} launch={l} presaleSoldOut={l.slug === 'gen2' ? presaleSoldOut : false} />
          ))}
        </div>
      )}
    </OwlCenterShell>
  )
}
