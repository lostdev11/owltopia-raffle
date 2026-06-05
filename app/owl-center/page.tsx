import type { Metadata } from 'next'

import { CollectionCard } from '@/components/owl-center/CollectionCard'
import { Gen2FeaturedLaunch } from '@/components/owl-center/Gen2FeaturedLaunch'
import { OwlCenterHubQuickLinks, OwlCenterSubmitHint } from '@/components/owl-center/OwlCenterHubSections'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { listOwlCenterLaunchesPublic } from '@/lib/db/owl-center-launch'
import { getGen2PresaleSoldOutForDisplay } from '@/lib/gen2-presale/owl-center-presale-status'
import { PLATFORM_NAME } from '@/lib/site-config'

export const metadata: Metadata = {
  title: `Owl Center | ${PLATFORM_NAME}`,
  description:
    'Solana NFT launch infrastructure — presales, phased mints, sellouts, and trading activation for Owltopia Gen2 and future collections.',
}

export default async function OwlCenterHomePage() {
  const [launches, presaleSoldOut] = await Promise.all([
    listOwlCenterLaunchesPublic(),
    getGen2PresaleSoldOutForDisplay(),
  ])
  const gen2 = launches.find((l) => l.slug === 'gen2')
  const featured = gen2 ?? launches.find((l) => l.is_featured) ?? launches[0]

  const liveMints = launches.filter(
    (l) => l.active_phase !== 'SOLD_OUT' && l.active_phase !== 'TRADING_ACTIVE' && l.status !== 'SOLD_OUT'
  )
  const soldOut = launches.filter((l) => l.active_phase === 'SOLD_OUT' || l.status === 'SOLD_OUT')
  const trading = launches.filter((l) => l.active_phase === 'TRADING_ACTIVE')

  return (
    <OwlCenterShell>
      <section className="mb-16 border-b border-[#1A222B] pb-14">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.4em] text-[#00C97A]">Owltopia // Command</p>
        <h1 className="mt-4 font-display text-5xl tracking-tight text-[#F4FBF8] md:text-6xl">Launch. Control. Activate.</h1>
        <p className="mt-4 max-w-2xl text-lg text-[#9BA8B4]">
          Solana NFT launch infrastructure for presales, mints, sellouts, and trading activation.
        </p>
        <OwlCenterHubQuickLinks />
      </section>

      {featured ? (
        <section className="mb-16">
          <h2 className="sr-only">Featured launch</h2>
          <Gen2FeaturedLaunch launch={featured} presaleSoldOut={presaleSoldOut} />
        </section>
      ) : null}

      <section className="mb-16">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">Live mints</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {liveMints.length ? (
            liveMints.map((l) => (
              <CollectionCard key={l.id} launch={l} presaleSoldOut={l.slug === 'gen2' ? presaleSoldOut : false} />
            ))
          ) : (
            <p className="font-mono text-sm text-[#5C6773]">No live primary mints — see upcoming or trading.</p>
          )}
        </div>
      </section>

      <section className="mb-16">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">Upcoming collections</h2>
        <OwlCenterSubmitHint />
      </section>

      <section className="mb-16">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">Recently sold out</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {soldOut.length ? (
            soldOut.map((l) => (
              <CollectionCard key={l.id} launch={l} presaleSoldOut={l.slug === 'gen2' ? presaleSoldOut : false} />
            ))
          ) : (
            <p className="font-mono text-sm text-[#5C6773]">None yet.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">Trading active</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {trading.length ? (
            trading.map((l) => (
              <CollectionCard key={l.id} launch={l} presaleSoldOut={l.slug === 'gen2' ? presaleSoldOut : false} />
            ))
          ) : (
            <p className="font-mono text-sm text-[#5C6773]">No collections in TRADING_ACTIVE — Magic Eden / Tensor links admin-controlled.</p>
          )}
        </div>
      </section>
    </OwlCenterShell>
  )
}
