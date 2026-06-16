import Link from 'next/link'

import { LaunchMintDetails } from '@/components/owl-center/LaunchMintDetails'
import { PhaseBadge } from '@/components/owl-center/PhaseBadge'
import { owlCenterBtnGhost } from '@/components/owl-center/owl-center-cta-styles'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

export function Gen2FeaturedLaunch({
  launch,
  presaleSoldOut = false,
}: {
  launch: OwlCenterLaunchPublic
  presaleSoldOut?: boolean
}) {
  const isGen2 = launch.slug === 'gen2'
  const showPresalePulse = isGen2 && launch.active_phase === 'PRESALE' && !presaleSoldOut

  return (
    <div className="border border-[#00FF9C]/35 bg-[#10161C]/95 p-6 shadow-[0_0_48px_rgba(0,255,156,0.08)] md:p-10">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#00C97A]">Featured Launch</span>
        <PhaseBadge phase={launch.active_phase} pulse={showPresalePulse} presaleSoldOut={presaleSoldOut} />
      </div>
      <h2 className="mt-4 font-display text-3xl text-[#F4FBF8] md:text-4xl">{launch.name}</h2>
      <p className="mt-2 max-w-2xl text-sm text-[#9BA8B4]">
        Powered by Owl Center — Solana-native launch infrastructure for phased mint and trading activation.
      </p>
      <p className="mt-4 max-w-2xl text-xs text-[#9BA8B4]">
        Presale is complete. Check allocation on the Gen2 mint page — prepaid spots redeem as free mints when your
        phase is live.
      </p>
      <div className="mt-6 max-w-xl">
        <LaunchMintDetails launch={launch} />
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/owl-center/collection/gen2" className={`${owlCenterBtnGhost} min-w-[200px]`}>
          View Gen2 Mint Page
        </Link>
      </div>
    </div>
  )
}
