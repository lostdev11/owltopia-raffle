import type { Metadata } from 'next'
import Link from 'next/link'

import { CollectionCard } from '@/components/owl-center/CollectionCard'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { listOwlCenterLaunchesPublic } from '@/lib/db/owl-center-launch'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Live Drops | Owl Center | ${PLATFORM_NAME}`,
  description: 'Active Owltopia Owl Center mints and launches — Solana only.',
}

export default async function OwlCenterDropsPage() {
  const launches = await listOwlCenterLaunchesPublic()
  const live = launches.filter((l) => l.status !== 'SOLD_OUT' && l.active_phase !== 'TRADING_ACTIVE')

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // DROPS"
      title="Live mints"
      subtitle="Solana-native launches tracked by Owl Center — presale, whitelist, public, and trading activation."
    >
      <div className="mb-8 flex flex-wrap gap-3">
        <Link
          href="/owl-center"
          className="font-mono text-xs uppercase tracking-widest text-[#00C97A] underline-offset-4 hover:underline"
        >
          ← Hub
        </Link>
        <Link
          href="/owl-center/launch"
          className="font-mono text-xs uppercase tracking-widest text-[#5C6773] underline-offset-4 hover:text-[#00FF9C] hover:underline"
        >
          Submit collection
        </Link>
      </div>

      {live.length === 0 ? (
        <p className="font-mono text-sm text-[#5C6773]">No active primary mints — check trading or upcoming.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {live.map((l) => (
            <CollectionCard key={l.id} launch={l} />
          ))}
        </div>
      )}
    </OwlCenterShell>
  )
}
